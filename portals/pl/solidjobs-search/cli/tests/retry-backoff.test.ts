import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { HttpError, fetchText } from "../src/helpers.ts"

// Offline: fetchText against a mocked fetch, with the backoff sleeps skipped.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
// every delay the code asked for, recorded before the sleep is skipped
let delays: number[] = []

beforeEach(() => {
  delays = []
  // Run backoff sleeps immediately; AbortSignal.timeout does not use this global.
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0)
    return originalSetTimeout(fn, 0)
  }) as unknown as typeof setTimeout
})

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
})

function mockStatuses(statuses: number[], okBody = "ok"): { calls: () => number } {
  let n = 0
  globalThis.fetch = (async () => {
    const status = statuses[Math.min(n, statuses.length - 1)]
    n++
    return new Response(status === 200 ? okBody : `status ${status}`, { status })
  }) as unknown as typeof fetch
  return { calls: () => n }
}

describe("fetchText", () => {
  test("retries a 429 and returns the eventual body", async () => {
    const m = mockStatuses([429, 429, 200], "payload")
    expect(await fetchText("https://solid.jobs/x", "application/json")).toBe("payload")
    expect(m.calls()).toBe(3)
  })

  test("retries a 5xx and returns the eventual body", async () => {
    const m = mockStatuses([503, 200], "payload")
    expect(await fetchText("https://solid.jobs/x", "application/json")).toBe("payload")
    expect(m.calls()).toBe(2)
  })

  test("gives up after 7 attempts on a persistent 429", async () => {
    const m = mockStatuses([429])
    const err = await fetchText("https://solid.jobs/x", "application/json").catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(429)
    expect(m.calls()).toBe(7)
  })

  test("a 404 returns an empty string without retrying", async () => {
    const m = mockStatuses([404])
    expect(await fetchText("https://solid.jobs/x", "application/json")).toBe("")
    expect(m.calls()).toBe(1)
  })

  test("a 400 throws with the response body and is not retried", async () => {
    const m = mockStatuses([400])
    const err = await fetchText("https://solid.jobs/x", "application/json").catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(400)
    expect((err as HttpError).message).toContain("status 400")
    expect(m.calls()).toBe(1)
  })

  test("sends the requested Accept header and a User-Agent", async () => {
    let headers: Record<string, string> = {}
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>
      return new Response("ok")
    }) as unknown as typeof fetch
    await fetchText("https://solid.jobs/x", "application/json")
    expect(headers.Accept).toBe("application/json")
    expect(headers["User-Agent"]).toContain("solidjobs-cli")
  })

  test("backoff doubles from 500 ms, capped at 8 s, with under 500 ms of jitter", async () => {
    mockStatuses([429])
    await fetchText("https://solid.jobs/x", "application/json").catch(() => undefined)
    // six waits between seven attempts; the AbortSignal timeout does not go through this stub
    const waits = delays.filter((d) => d >= 500)
    expect(waits).toHaveLength(6)
    const bases = [500, 1000, 2000, 4000, 8000, 8000]
    waits.forEach((d, i) => {
      expect(d).toBeGreaterThanOrEqual(bases[i]!)
      expect(d).toBeLessThan(bases[i]! + 500)
    })
  })
})
