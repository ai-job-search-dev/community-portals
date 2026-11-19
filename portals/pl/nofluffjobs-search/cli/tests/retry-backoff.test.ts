import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { htmlFetch } from "../src/helpers.js"

// Offline: htmlFetch against a mocked fetch, with the backoff sleeps skipped.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout

beforeEach(() => {
  globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as unknown as typeof setTimeout
})

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
})

function mockStatuses(statuses: number[], okBody = "ok"): { calls: () => number } {
  let n = 0
  globalThis.fetch = (async () => {
    const status = statuses[Math.min(n, statuses.length - 1)]!
    n++
    return new Response(status === 200 ? okBody : `status ${status}`, { status })
  }) as unknown as typeof fetch
  return { calls: () => n }
}

describe("htmlFetch", () => {
  test("retries a 429 and returns the eventual body", async () => {
    const m = mockStatuses([429, 429, 200], "<html>ok</html>")
    expect(await htmlFetch("https://nofluffjobs.com/x")).toBe("<html>ok</html>")
    expect(m.calls()).toBe(3)
  })

  test("retries a 5xx and returns the eventual body", async () => {
    const m = mockStatuses([503, 200], "<html>ok</html>")
    expect(await htmlFetch("https://nofluffjobs.com/x")).toBe("<html>ok</html>")
    expect(m.calls()).toBe(2)
  })

  test("gives up after 7 attempts on a persistent 429", async () => {
    const m = mockStatuses([429])
    await expect(htmlFetch("https://nofluffjobs.com/x")).rejects.toThrow(/429/)
    expect(m.calls()).toBe(7)
  })

  test("a 404 returns an empty string without retrying", async () => {
    const m = mockStatuses([404])
    expect(await htmlFetch("https://nofluffjobs.com/x")).toBe("")
    expect(m.calls()).toBe(1)
  })

  test("a 403 throws and is not retried", async () => {
    const m = mockStatuses([403])
    await expect(htmlFetch("https://nofluffjobs.com/x")).rejects.toThrow(/403/)
    expect(m.calls()).toBe(1)
  })

  test("sends an HTML Accept header and a User-Agent", async () => {
    let headers: Record<string, string> = {}
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>
      return new Response("ok")
    }) as unknown as typeof fetch
    await htmlFetch("https://nofluffjobs.com/x")
    expect(headers.Accept).toContain("text/html")
    expect(headers["User-Agent"]).toBeTruthy()
  })
})
