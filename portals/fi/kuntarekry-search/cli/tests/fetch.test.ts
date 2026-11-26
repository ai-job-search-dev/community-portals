import { afterEach, describe, expect, test } from "bun:test"
import { kuntarekryGet, retryAfterMs, USER_AGENT } from "../src/helpers"

// The portal contract requires backoff on 429/5xx. A stubbed fetch counts
// attempts, and a stubbed setTimeout fires at once so the tests do not sleep
// through the real 500 ms -> 8 s schedule.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
})

function instantTimers(): number[] {
  const waits: number[] = []
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    waits.push(ms ?? 0)
    return originalSetTimeout(fn, 0)
  }) as unknown as typeof setTimeout
  return waits
}

function stubFetch(responses: Array<() => Response>) {
  const state = { calls: 0, urls: [] as string[], inits: [] as RequestInit[] }
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    state.urls.push(String(input))
    state.inits.push(init ?? {})
    const i = Math.min(state.calls, responses.length - 1)
    state.calls++
    return responses[i]()
  }, { preconnect() {} }) as typeof fetch
  return state
}

describe("kuntarekryGet", () => {
  test("sends an honest User-Agent, refuses redirects and stays on kuntarekry.fi", async () => {
    const state = stubFetch([() => new Response("{}")])
    await kuntarekryGet("/fi/api/filters-data/", "json")
    expect(state.urls).toEqual(["https://kuntarekry.fi/fi/api/filters-data/"])
    expect(new Headers(state.inits[0].headers).get("User-Agent")).toBe(USER_AGENT)
    expect(USER_AGENT).toBe("Mozilla/5.0 (compatible; kuntarekry-cli/1.0)")
    expect(state.inits[0].redirect).toBe("error")
  })

  test("refuses anything but a path", async () => {
    await expect(kuntarekryGet("https://evil.example/", "json")).rejects.toMatchObject({ code: "BAD_ARG" })
  })

  test("retries a 429 and a 503, then succeeds", async () => {
    const waits = instantTimers()
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response("", { status: 503 }),
      () => new Response("ok"),
    ])
    expect(await kuntarekryGet("/x/", "html")).toBe("ok")
    expect(state.calls).toBe(3)
    expect(waits[0]).toBeGreaterThanOrEqual(500)
    expect(waits[1]).toBeGreaterThanOrEqual(1000)
  })

  test("honours Retry-After when it asks for longer than the backoff", async () => {
    const waits = instantTimers()
    stubFetch([() => new Response("", { status: 429, headers: { "Retry-After": "3" } }), () => new Response("ok")])
    await kuntarekryGet("/x/", "html")
    expect(waits[0]).toBe(3000)
  })

  test("gives up with RATE_OR_SERVER_ERROR when the retry budget runs out", async () => {
    const waits = instantTimers()
    const state = stubFetch([() => new Response("", { status: 500 })])
    await expect(kuntarekryGet("/x/", "html")).rejects.toMatchObject({ code: "RATE_OR_SERVER_ERROR" })
    // Six backoffs (at most 26.5 s with jitter) fit the 30 s budget, so every retry is used.
    expect(state.calls).toBe(7)
    expect(waits.length).toBe(6)
  })

  test("a 404 is null, another 4xx is HTTP_ERROR without a retry", async () => {
    stubFetch([() => new Response("", { status: 404 })])
    expect(await kuntarekryGet("/x/", "html")).toBeNull()
    const state = stubFetch([() => new Response("", { status: 403 })])
    await expect(kuntarekryGet("/x/", "html")).rejects.toMatchObject({ code: "HTTP_ERROR" })
    expect(state.calls).toBe(1)
  })

  test("a timeout is reported as TIMEOUT", async () => {
    globalThis.fetch = Object.assign(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError")
    }, { preconnect() {} }) as typeof fetch
    await expect(kuntarekryGet("/x/", "html")).rejects.toMatchObject({ code: "TIMEOUT" })
  })
})

test("retryAfterMs reads seconds and HTTP dates", () => {
  expect(retryAfterMs("2")).toBe(2000)
  expect(retryAfterMs("Wed, 25 Nov 2026 10:00:10 GMT", Date.parse("Wed, 25 Nov 2026 10:00:00 GMT"))).toBe(10_000)
  expect(retryAfterMs("soon")).toBeNull()
  expect(retryAfterMs(null)).toBeNull()
})
