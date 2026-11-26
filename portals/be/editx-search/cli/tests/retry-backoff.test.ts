import { afterEach, describe, expect, test } from "bun:test"
import { apiGet, retryAfterMs } from "../src/helpers"

// The contract requires exponential backoff with jitter on 429/5xx. A stubbed
// fetch serves canned responses, and a stubbed setTimeout records each delay
// and fires immediately, so the real schedule is asserted without sleeping.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
})

function recordDelays(): number[] {
  const delays: number[] = []
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0)
    return originalSetTimeout(fn, 0)
  }) as unknown as typeof setTimeout
  return delays
}

function stubFetch(responses: Array<() => Response>): { calls: number; inits: RequestInit[] } {
  const state = { calls: 0, inits: [] as RequestInit[] }
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    state.inits.push(init)
    const i = Math.min(state.calls, responses.length - 1)
    state.calls++
    return responses[i]()
  }) as unknown as typeof fetch
  return state
}

const ok = () => Response.json({ total: 0, jobs: [] })

describe("apiGet retry/backoff", () => {
  test("retries a 429 then succeeds; first delay is 500ms plus up to 500ms jitter", async () => {
    const delays = recordDelays()
    const state = stubFetch([() => new Response("", { status: 429 }), ok])
    expect(await apiGet("/api/editx/jobs?keyword=x")).toEqual({ total: 0, jobs: [] })
    expect(state.calls).toBe(2)
    expect(delays).toHaveLength(1)
    expect(delays[0]).toBeGreaterThanOrEqual(500)
    expect(delays[0]).toBeLessThan(1000)
  })

  test("adds jitter on top of the base delay", async () => {
    const originalRandom = Math.random
    Math.random = () => 0.99
    try {
      const delays = recordDelays()
      stubFetch([() => new Response("", { status: 503 }), () => new Response("", { status: 503 }), ok])
      await apiGet("/api/editx/jobs?keyword=x")
      expect(delays).toEqual([500 + 495, 1000 + 495])
    } finally {
      Math.random = originalRandom
    }
  })

  test("doubles the base delay up to 8s and gives up after six retries", async () => {
    const delays = recordDelays()
    const state = stubFetch([() => new Response("", { status: 503 })])
    await expect(apiGet("/api/editx/jobs?keyword=x")).rejects.toThrow(/503/)
    expect(state.calls).toBe(7)
    const bases = [500, 1000, 2000, 4000, 8000, 8000]
    expect(delays).toHaveLength(bases.length)
    delays.forEach((d, i) => {
      expect(d).toBeGreaterThanOrEqual(bases[i])
      expect(d).toBeLessThan(bases[i] + 500)
    })
  })

  test("waits at least as long as Retry-After asks", async () => {
    const delays = recordDelays()
    stubFetch([() => new Response("", { status: 429, headers: { "Retry-After": "3" } }), ok])
    await apiGet("/api/editx/jobs?keyword=x")
    expect(delays[0]).toBeGreaterThanOrEqual(3000)
  })

  test("a Retry-After past the 30s budget fails at once", async () => {
    const delays = recordDelays()
    const state = stubFetch([() => new Response("", { status: 429, headers: { "Retry-After": "120" } })])
    await expect(apiGet("/api/editx/jobs?keyword=x")).rejects.toThrow(/retry budget/)
    expect(state.calls).toBe(1)
    expect(delays).toHaveLength(0)
  })

  test("404 returns null without retrying", async () => {
    const state = stubFetch([() => Response.json("Not Found", { status: 404 })])
    expect(await apiGet("/api/editx/job/1")).toBeNull()
    expect(state.calls).toBe(1)
  })

  test("a redirect is refused, never followed off the API host", async () => {
    const state = stubFetch([() => new Response("", { status: 302, headers: { Location: "https://evil.example/" } })])
    await expect(apiGet("/api/editx/job/1")).rejects.toThrow(/redirect/)
    expect(state.calls).toBe(1)
    expect(state.inits[0].redirect).toBe("manual")
  })

  test("sends the honest tool User-Agent and a timeout signal", async () => {
    const state = stubFetch([ok])
    await apiGet("/api/editx/jobs?keyword=x")
    const headers = state.inits[0].headers as Record<string, string>
    expect(headers["User-Agent"]).toBe("Mozilla/5.0 (compatible; editx-search-cli/1.0)")
    expect(state.inits[0].signal).toBeInstanceOf(AbortSignal)
  })

  test("a connection failure fails fast", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch
    await expect(apiGet("/api/editx/jobs?keyword=x")).rejects.toThrow(/could not reach/)
    expect(calls).toBe(1)
  })
})

describe("retryAfterMs", () => {
  test("delta-seconds, HTTP-date and junk", () => {
    expect(retryAfterMs("2")).toBe(2000)
    expect(retryAfterMs("Wed, 25 Nov 2026 12:00:10 GMT", Date.parse("Wed, 25 Nov 2026 12:00:00 GMT"))).toBe(10000)
    expect(retryAfterMs("soon")).toBeNull()
    expect(retryAfterMs(null)).toBeNull()
  })
})
