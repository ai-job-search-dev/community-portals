import { afterEach, describe, expect, test } from "bun:test"
import { runSearch, type SearchOpts } from "../src/commands/search.ts"

// Offline: --all paging against a mocked API.

const originalFetch = globalThis.fetch
const originalStdout = process.stdout.write
const originalStderr = process.stderr.write

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalStdout
  process.stderr.write = originalStderr
})

function capture(stream: "stdout" | "stderr"): () => string {
  let buf = ""
  process[stream].write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString()
    return true
  }) as typeof process.stdout.write
  return () => buf
}

function rawJob(id: number, validFrom: string) {
  return { title: `Backend ${id}`, url: `https://solid.jobs/o/c${id}`, company: "Acme", isRemote: true, validFrom }
}

/** Mock API: `pages[i]` answers pageIndex i; totalPages reported as given. */
function mockPages(pages: ReturnType<typeof rawJob>[][], totalPages = 99): string[] {
  const seen: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const idx = new URL(String(input)).searchParams.get("pageIndex")!
    seen.push(idx)
    const jobs = pages[Number(idx)] ?? []
    return new Response(JSON.stringify({ pageIndex: Number(idx), pageSize: 50, totalCount: 9999, totalPages, jobs }), {
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return seen
}

const full = (start: number, validFrom: string) =>
  Array.from({ length: 50 }, (_, i) => rawJob(start + i, validFrom))

const base: SearchOpts = { division: "IT", page: 1, all: true, pageDelayMs: 0, format: "json" }
const today = new Date().toISOString().slice(0, 10)

describe("search --all", () => {
  test("sweeps pageIndex until a short page", async () => {
    const seen = mockPages([full(0, today), full(100, today), [rawJob(200, today)]])
    const out = capture("stdout")
    expect(await runSearch(base)).toBe(0)
    expect(seen).toEqual(["0", "1", "2"])
    expect(JSON.parse(out()).meta).toMatchObject({ count: 101, pages: 3, truncated: false })
  })

  test("stops at the reported last page without an extra request", async () => {
    const seen = mockPages([full(0, today), full(100, today)], 2)
    capture("stdout")
    await runSearch(base)
    expect(seen).toEqual(["0", "1"])
  })

  test("with --jobage, stops once a page reaches offers older than the window", async () => {
    // Newest first by validFrom: page 2 already ends before the window, so no page 3.
    const seen = mockPages([full(0, today), [...full(100, today).slice(0, 49), rawJob(149, "2020-01-01")], full(200, today)])
    const out = capture("stdout")
    await runSearch({ ...base, jobage: 1 })
    expect(seen).toEqual(["0", "1"])
    expect(JSON.parse(out()).meta.count).toBe(99)
  })

  test("stops at the 10-page hard cap and warns PAGE_CAP_REACHED", async () => {
    const seen = mockPages(Array.from({ length: 12 }, (_, p) => full(p * 100, today)))
    const out = capture("stdout")
    const err = capture("stderr")
    await runSearch(base)
    expect(seen).toHaveLength(10)
    expect(JSON.parse(out()).meta).toMatchObject({ count: 500, pages: 10, truncated: true })
    expect(err()).toContain("PAGE_CAP_REACHED")
  })
})
