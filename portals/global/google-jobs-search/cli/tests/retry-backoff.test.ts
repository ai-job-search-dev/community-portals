import { afterEach, describe, expect, test } from "bun:test"
import { ApiError, apiRequest, jobageToDatePosted, parseDetailId, contractDate } from "../src/helpers"

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts, and a stubbed setTimeout fires
// immediately so the exhaustion case does not sleep through the real 500ms ->
// 8s backoff schedule. The CLI-level 429 recovery path is pinned in
// search.test.ts against the loopback fake server.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
})

function instantTimers() {
  globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as unknown as typeof setTimeout
}

/**
 * Replace setTimeout so the timer fires at once, while recording the delay each
 * call asked for. The recorded delays are what the backoff assertions read: a
 * zero or constant wait would otherwise pass unseen.
 */
function recordingTimers(): { delays: number[] } {
  const state = { delays: [] as number[] }
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...args: unknown[]) => {
    state.delays.push(Number(ms))
    return originalSetTimeout(fn, 0, ...args)
  }) as unknown as typeof setTimeout
  return state
}

function stubFetch(responses: Array<() => Response>): { calls: number } {
  const state = { calls: 0 }
  globalThis.fetch = (async () => {
    const i = Math.min(state.calls, responses.length - 1)
    state.calls++
    return responses[i]()
  }) as unknown as typeof fetch
  return state
}

/**
 * A response whose body errors part-way through, after emitting `prefix`. The
 * stream's `pull` enqueues the prefix once, then errors on the next read, so the
 * failure happens while the body is being read, not while the fetch resolves.
 */
function brokenBodyResponse(prefix = ""): Response {
  const encoder = new TextEncoder()
  let sent = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true
        if (prefix) controller.enqueue(encoder.encode(prefix))
        return
      }
      controller.error(new TypeError("The stream was interrupted"))
    },
  })
  return new Response(stream, { status: 200 })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (e) {
    return e instanceof ApiError ? e.code : "NOT_API_ERROR"
  }
  return "NO_ERROR"
}

describe("apiRequest retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers()
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response('{"data":{}}', { status: 200 }),
    ])
    const body = await apiRequest("/x", { token: "t" })
    expect(body).toBe('{"data":{}}')
    expect(state.calls).toBe(2)
  })

  test("gives up after the initial attempt plus six retries on persistent 5xx", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 500 })])
    expect(await codeOf(apiRequest("/x", { token: "t" }))).toBe("HTTP_ERROR")
    expect(state.calls).toBe(7)
  })

  test("waits the exponential schedule (500ms doubling to 8s) plus 0-499ms jitter", async () => {
    const timers = recordingTimers()
    stubFetch([() => new Response("", { status: 500 })])
    expect(await codeOf(apiRequest("/x", { token: "t" }))).toBe("HTTP_ERROR")
    expect(timers.delays).toHaveLength(6)
    const windows: Array<[number, number]> = [
      [500, 1000],
      [1000, 1500],
      [2000, 2500],
      [4000, 4500],
      [8000, 8500],
      [8000, 8500],
    ]
    timers.delays.forEach((delay, i) => {
      const [lo, hi] = windows[i]
      expect(delay).toBeGreaterThanOrEqual(lo)
      expect(delay).toBeLessThan(hi)
    })
  })

  test("wraps a GET network failure in HTTP_ERROR and retries it", async () => {
    const timers = recordingTimers()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      if (calls <= 2) throw new TypeError("fetch failed")
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch
    expect(await apiRequest("/x", { token: "t" })).toBe("{}")
    expect(calls).toBe(3)
    expect(timers.delays).toHaveLength(2)
  })

  test("wraps a GET timeout in HTTP_ERROR, naming the error", async () => {
    instantTimers()
    globalThis.fetch = (async () => {
      throw new DOMException("The operation timed out.", "TimeoutError")
    }) as unknown as typeof fetch
    let message = ""
    try {
      await apiRequest("/x", { token: "t" })
    } catch (e) {
      expect(e instanceof ApiError).toBe(true)
      expect((e as ApiError).code).toBe("HTTP_ERROR")
      message = (e as ApiError).message
    }
    expect(message).toContain("TimeoutError")
  })

  test("retries a GET whose body stream breaks, and returns the next attempt's body", async () => {
    instantTimers()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return calls === 1 ? brokenBodyResponse("partial") : new Response("{}", { status: 200 })
    }) as unknown as typeof fetch
    expect(await apiRequest("/x", { token: "t" })).toBe("{}")
    expect(calls).toBe(2)
  })

  test("does not retry a POST whose body stream breaks: the run may have started", async () => {
    instantTimers()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return brokenBodyResponse()
    }) as unknown as typeof fetch
    expect(await codeOf(apiRequest("/acts/x/runs", { method: "POST", body: "{}", token: "t" }))).toBe("HTTP_ERROR")
    expect(calls).toBe(1)
  })

  test("gives up on a GET whose body stream always breaks, after seven attempts", async () => {
    instantTimers()
    const state = stubFetch([() => brokenBodyResponse()])
    expect(await codeOf(apiRequest("/x", { token: "t" }))).toBe("HTTP_ERROR")
    expect(state.calls).toBe(7)
  })

  test("a failed error-body read still reports the status, not the read error", async () => {
    instantTimers()
    globalThis.fetch = (async () => {
      // Status 400, but the body stream errors before any text arrives.
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(encoder.encode("partial"))
          controller.error(new TypeError("The stream was interrupted"))
        },
      })
      return new Response(stream, { status: 400, statusText: "Bad Request" })
    }) as unknown as typeof fetch
    let message = ""
    let status: number | undefined
    try {
      await apiRequest("/x", { token: "t" })
    } catch (e) {
      expect(e instanceof ApiError).toBe(true)
      expect((e as ApiError).code).toBe("HTTP_ERROR")
      status = (e as ApiError).status
      message = (e as ApiError).message
    }
    expect(status).toBe(400)
    expect(message).toContain("400")
    expect(message).toContain("Bad Request")
  })

  test("does not retry a POST on a network failure: the run may have started", async () => {
    instantTimers()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch
    expect(await codeOf(apiRequest("/acts/x/runs", { method: "POST", body: "{}", token: "t" }))).toBe("HTTP_ERROR")
    expect(calls).toBe(1)
  })

  test("does not retry a POST on 5xx: the run may have started and runs are billed", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 502 })])
    expect(await codeOf(apiRequest("/acts/x/runs", { method: "POST", body: "{}", token: "t" }))).toBe("HTTP_ERROR")
    expect(state.calls).toBe(1)
  })

  test("retries a POST on 429: the request was refused, nothing started", async () => {
    instantTimers()
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response('{"data":{}}', { status: 201 }),
    ])
    expect(await apiRequest("/acts/x/runs", { method: "POST", body: "{}", token: "t" })).toBe('{"data":{}}')
    expect(state.calls).toBe(2)
  })

  test("does not retry a 401 or 403", async () => {
    for (const status of [401, 403]) {
      const state = stubFetch([() => new Response("", { status })])
      expect(await codeOf(apiRequest("/x", { token: "t" }))).toBe("AUTH")
      expect(state.calls).toBe(1)
    }
  })

  test("maps 402 to QUOTA without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 402 })])
    expect(await codeOf(apiRequest("/x", { token: "t" }))).toBe("QUOTA")
    expect(state.calls).toBe(1)
  })

  test("sends the token as a bearer header, never in the URL", async () => {
    let seenUrl = ""
    let seenAuth = ""
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input)
      seenAuth = new Headers(init?.headers).get("authorization") ?? ""
      return new Response("{}", { status: 200 })
    }) as typeof fetch
    await apiRequest("/datasets/abc/items?offset=0&limit=1", { token: "secret-token" })
    expect(seenAuth).toBe("Bearer secret-token")
    expect(seenUrl).not.toContain("secret-token")
  })
})

describe("jobageToDatePosted", () => {
  const cases: Array<[number | undefined, string]> = [
    [undefined, "any"],
    [1, "24h"],
    [2, "3d"],
    [3, "3d"],
    [4, "7d"],
    [7, "7d"],
    [8, "30d"],
    [30, "30d"],
    [31, "any"],
  ]
  for (const [days, expected] of cases) {
    test(`${days ?? "unset"} -> ${expected}`, () => {
      expect(jobageToDatePosted(days)).toBe(expected)
    })
  }
})

describe("parseDetailId", () => {
  test("accepts <dataset_id>:<offset>", () => {
    expect(parseDetailId("jPV8SE3dHqcuO2M3C:0")).toEqual({ datasetId: "jPV8SE3dHqcuO2M3C", offset: 0 })
    expect(parseDetailId("abc_def-1:12")).toEqual({ datasetId: "abc_def-1", offset: 12 })
  })
  test("rejects malformed ids", () => {
    for (const bad of ["nocolon", "a:abc", "a:-1", ":5", "a:1:2", "a b:1", ""]) {
      expect(parseDetailId(bad)).toBeNull()
    }
  })
})

describe("contractDate", () => {
  test("passes a bare date through and cuts an ISO timestamp", () => {
    expect(contractDate("2026-11-26")).toBe("2026-11-26")
    expect(contractDate("2026-11-26T05:00:00Z")).toBe("2026-11-26")
  })
  test("is null for a missing or unparseable value", () => {
    expect(contractDate(null)).toBeNull()
    expect(contractDate(undefined)).toBeNull()
    expect(contractDate("22 hours ago")).toBeNull()
  })
})
