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

function stubFetch(responses: Array<() => Response>): { calls: number } {
  const state = { calls: 0 }
  globalThis.fetch = (async () => {
    const i = Math.min(state.calls, responses.length - 1)
    state.calls++
    return responses[i]()
  }) as unknown as typeof fetch
  return state
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
