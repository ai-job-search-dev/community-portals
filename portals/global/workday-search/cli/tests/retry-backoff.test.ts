import { afterEach, describe, expect, test } from "bun:test"
import { HttpError, requestJson } from "../src/helpers"

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts, and a stubbed setTimeout fires
// immediately so the exhaustion case does not sleep through the real schedule.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
})

function instantTimers(): number[] {
  const delays: number[] = []
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    delays.push(Number(ms ?? 0))
    return originalSetTimeout(fn, 0)
  }) as unknown as typeof setTimeout
  return delays
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

describe("requestJson retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers()
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response('{"total": 0}', { status: 200 }),
    ])
    await expect(requestJson("https://example.test/jobs")).resolves.toEqual({ total: 0 })
    expect(state.calls).toBe(2)
  })

  test("gives up with an HttpError after the retry budget", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 503 })])
    const error = await requestJson("https://example.test/jobs").catch((e) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(503)
    expect(state.calls).toBe(5)
  })

  test("does not retry a 404", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 404 })])
    const error = await requestJson("https://example.test/jobs").catch((e) => e)
    expect((error as HttpError).status).toBe(404)
    expect(state.calls).toBe(1)
  })

  test("waits a Retry-After the server asks for", async () => {
    const delays = instantTimers()
    const state = stubFetch([
      () => new Response("", { status: 429, headers: { "Retry-After": "1" } }),
      () => new Response('{"total": 0}', { status: 200 }),
    ])
    await expect(requestJson("https://example.test/jobs")).resolves.toEqual({ total: 0 })
    expect(state.calls).toBe(2)
    expect(delays.some((ms) => ms >= 1000)).toBe(true)
  })

  test("fails instead of retrying early when Retry-After exceeds the wait ceiling", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 429, headers: { "Retry-After": "60" } })])
    const error = await requestJson("https://example.test/jobs").catch((e) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(429)
    expect((error as Error).message).toContain("60s")
    expect(state.calls).toBe(1)
  })
})
