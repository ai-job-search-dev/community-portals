import { afterEach, describe, expect, test } from "bun:test"
import { callTool } from "../src/helpers.js"

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
})

function instantTimers() {
  globalThis.setTimeout = ((fn: () => void) =>
    originalSetTimeout(fn, 0)) as unknown as typeof setTimeout
}

function stubFetch(responses: Array<() => Response>): { calls: number } {
  const state = { calls: 0 }
  globalThis.fetch = (async () => {
    const index = Math.min(state.calls, responses.length - 1)
    state.calls += 1
    return responses[index]()
  }) as unknown as typeof fetch
  return state
}

function success(value: unknown): Response {
  return Response.json({
    jsonrpc: "2.0",
    result: { content: [{ type: "text", text: JSON.stringify(value) }] },
  })
}

describe("MCP retry/backoff", () => {
  test("retries a 429 and succeeds", async () => {
    instantTimers()
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => success({ jobs: [] }),
    ])

    await expect(callTool("search_jobs", { limit: 1 })).resolves.toEqual({ jobs: [] })
    expect(state.calls).toBe(2)
  })

  test("stops after three retries on persistent 5xx", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 503 })])

    await expect(callTool("search_jobs", { limit: 1 })).rejects.toThrow(/503/)
    expect(state.calls).toBe(4)
  })

  test("fails fast when the endpoint cannot be reached", async () => {
    const state = { calls: 0 }
    globalThis.fetch = (async () => {
      state.calls += 1
      throw new TypeError("Unable to connect")
    }) as unknown as typeof fetch

    await expect(callTool("search_jobs", { limit: 1 })).rejects.toThrow(/Could not reach/)
    expect(state.calls).toBe(1)
  })
})
