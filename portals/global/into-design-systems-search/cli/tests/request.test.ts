import { afterEach, expect, test } from "bun:test"
import { USER_AGENT, callTool } from "../src/helpers.js"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("names the tool in an honest User-Agent and sends one JSON-RPC call", async () => {
  let seen: { url: string; init: RequestInit } | undefined
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url, init }
    return Response.json({ jsonrpc: "2.0", result: { content: [{ type: "text", text: "{}" }] } })
  }) as unknown as typeof fetch

  await callTool("search_jobs", { limit: 1 })

  const headers = seen!.init.headers as Record<string, string>
  expect(seen!.url).toBe("https://jobs.intodesignsystems.com/mcp")
  expect(headers["User-Agent"]).toBe(USER_AGENT)
  expect(USER_AGENT).toContain("into-design-systems-cli")

  const body = JSON.parse(seen!.init.body as string)
  expect(body).toMatchObject({ jsonrpc: "2.0", method: "tools/call", params: { name: "search_jobs" } })
})
