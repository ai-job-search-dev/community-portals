import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI, runWithRoutes } from "./helpers.ts"

interface SearchOut {
  meta: { count: number; page: number; pagesRead: number; total: number | null; hasNext: boolean }
  results: Array<Record<string, unknown>>
}

const JOBS = "gracklehq.com/jobs"

describe("search through the real CLI with saved pages", () => {
  test("returns the contract shape and drops substring-only matches", async () => {
    const { result, requests } = await runWithRoutes(["search", "-q", "unity"], { [JOBS]: { file: "search-unity-p1.html" } })
    const out = parseJSON<SearchOut>(result)
    expect(out.meta).toMatchObject({ page: 1, pagesRead: 1, total: 37, hasNext: true })
    expect(out.results.map((r) => r.title)).toEqual(["Engineering Manager (Unity)"])
    for (const r of out.results) for (const k of ["id", "title", "company", "location", "date", "url"]) expect(r).toHaveProperty(k)
    expect(requests).toHaveLength(1)
  })

  test("--jobage without --page keeps reading while results are in range, then stops", async () => {
    // Every request returns page 1, whose last card is 10 days old: inside a 30-day
    // window, so the CLI reads on, up to its 5-page cap.
    const { result, requests } = await runWithRoutes(["search", "-q", "unity", "--jobage", "30"], {
      [JOBS]: { file: "search-unity-p1.html" },
    })
    expect(parseJSON<SearchOut>(result).meta.pagesRead).toBe(5)
    expect(requests).toHaveLength(5)
    // A 5-day window stops after the first page (its last card is older).
    const short = await runWithRoutes(["search", "-q", "unity", "--jobage", "5"], { [JOBS]: { file: "search-unity-p1.html" } })
    expect(short.requests).toHaveLength(1)
    expect(parseJSON<SearchOut>(short.result).results).toEqual([])
  })

  test("an explicit --page reads exactly that page", async () => {
    const { result } = await runWithRoutes(["search", "-q", "unity", "--page", "2", "--jobage", "999"], {
      [JOBS]: { file: "search-unity-p2.html" },
    })
    const out = parseJSON<SearchOut>(result)
    expect(out.meta).toMatchObject({ page: 2, pagesRead: 1, hasNext: false })
    expect(out.results).toHaveLength(3)
  })

  test("table and plain formats render", async () => {
    const table = await runWithRoutes(["search", "-d", "Engineering", "-l", "Remote", "--format", "table"], {
      [JOBS]: { file: "search-engineering-remote.html" },
    })
    expect(table.result.stdout).toContain("QA Engineering & Automation")
    const plain = await runWithRoutes(["search", "--format", "plain"], { [JOBS]: { file: "search-engineering-remote.html" } })
    expect(plain.result.stdout).toMatch(/id: \d+/)
  })

  test("a 404 page yields an empty list, not a crash", async () => {
    const { result } = await runWithRoutes(["search", "-q", "unity"], { [JOBS]: { status: 404 } })
    expect(parseJSON<SearchOut>(result).results).toEqual([])
  })
})

describe("detail resolves the redirect without following it", () => {
  test("json gives the employer's posting URL", async () => {
    const { result, requests } = await runWithRoutes(["detail", "https://gracklehq.com/rd/384925"], {
      "gracklehq.com/rd/384925": { status: 302, location: "https://jobs.example-studio.com/careers/42" },
    })
    const job = parseJSON<Record<string, unknown>>(result)
    expect(job).toMatchObject({
      id: "384925",
      postingUrl: "https://jobs.example-studio.com/careers/42",
      postingHost: "jobs.example-studio.com",
      description: null,
      isActive: true,
    })
    expect(requests.map((r) => r.key)).toEqual(["gracklehq.com/rd/384925"])
  })

  test("a removed job exits 1 with NOT_FOUND", async () => {
    const { result } = await runWithRoutes(["detail", "1"], { "gracklehq.com/rd/1": { status: 404 } })
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("NOT_FOUND")
  })
})

describe("argument errors exit 1 with JSON on stderr", () => {
  for (const [name, args, code] of [
    ["unknown flag", ["search", "--bogus", "1"], "UNKNOWN_FLAG"],
    ["bad number", ["search", "--jobage", "0"], "BAD_ARG"],
    ["bad format", ["search", "--format", "xml"], "BAD_ARG"],
    ["detail without id", ["detail"], "NO_ID"],
    ["detail on another host", ["detail", "https://example.com/rd/1"], "BAD_ID"],
    ["unknown command", ["frobnicate"], "BAD_CMD"],
  ] as const) {
    test(name, async () => {
      const result = await runCLI([...args])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe("")
      expect(JSON.parse(result.stderr).code).toBe(code)
    })
  }
})
