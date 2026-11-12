import { afterEach, describe, expect, test } from "bun:test"
import { runSearch } from "../src/commands/search.js"

const originalFetch = globalThis.fetch
const originalWrite = process.stdout.write

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalWrite
})

/** Answer every call with one truncated page, and capture what the command prints. */
function run(format: "table" | "plain" | "json", response: Record<string, unknown>) {
  globalThis.fetch = (async () =>
    Response.json({
      jsonrpc: "2.0",
      result: { content: [{ type: "text", text: JSON.stringify(response) }] },
    })) as unknown as typeof fetch

  let out = ""
  process.stdout.write = ((chunk: string) => {
    out += chunk
    return true
  }) as typeof process.stdout.write

  return runSearch({ limit: 20, format }).then(() => out)
}

const JOB = {
  slug: "a-role",
  title: "Role",
  company: "Co",
  city: "Berlin",
  country: "Germany",
  posted: "2026-11-12",
  applyUrl: "https://example.test/apply",
}

describe("truncation is visible in every format", () => {
  for (const format of ["table", "plain"] as const) {
    test(`${format} output carries the notice`, async () => {
      const out = await run(format, { total: 209, truncated: true, jobs: [JOB] })
      expect(out).toContain("209 roles match")
      expect(out).toContain("--jobage and --before")
    })

    test(`${format} output says nothing when the search is complete`, async () => {
      const out = await run(format, { total: 1, truncated: false, jobs: [JOB] })
      expect(out).not.toContain("match. Narrow")
    })
  }

  test("falls back when the board sends no total", async () => {
    const out = await run("table", { truncated: true, jobs: [JOB] })
    expect(out).toContain("More roles match")
  })

  test("JSON passes the server's own note through rather than the local text", async () => {
    const note = "More roles match than were returned. Narrow the range with postedAfter."
    const out = await run("json", { total: 209, truncated: true, truncatedNote: note, jobs: [JOB] })
    const parsed = JSON.parse(out)
    expect(parsed.meta.truncatedNote).toBe(note)
    expect(out).not.toContain("roles match. Narrow with")
  })
})
