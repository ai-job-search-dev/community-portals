import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI, runWithFixtures } from "./helpers.ts"

interface SearchOut {
  meta: { count: number; page: number; total: number; hasNext: boolean }
  results: Array<Record<string, unknown>>
}

const SEARCH = { "/search": "search-unity.html", "/feed.rss": "feed.rss" }

describe("search through the real CLI with saved responses", () => {
  test("returns the contract shape, sends the query, and dates cards from the feed", async () => {
    const { result, requests } = await runWithFixtures(["search", "-q", "unity"], SEARCH)
    const out = parseJSON<SearchOut>(result)
    expect(out.meta).toMatchObject({ count: 3, page: 1, total: 3, hasNext: false })
    for (const r of out.results) {
      for (const key of ["id", "title", "company", "location", "date", "url"]) expect(r).toHaveProperty(key)
    }
    expect(out.results[0].date).toBe("2026-10-15")
    const search = requests.find((r) => r.pathname === "/search")!
    expect(search.searchParams.get("query")).toBe("unity")
    expect(requests.map((r) => r.pathname).sort()).toEqual(["/feed.rss", "/search"])
  })

  test("--category alone reads the category page", async () => {
    const { result, requests } = await runWithFixtures(["search", "-c", "programming"], {
      "/remote-game-programming-jobs": "search-unity.html",
      "/feed.rss": "feed.rss",
    })
    expect(parseJSON<SearchOut>(result).results).toHaveLength(3)
    expect(requests.some((r) => r.pathname === "/search")).toBe(false)
  })

  test("--query with --category intersects both lists", async () => {
    // search: 3 cards; category: 1 of them plus 1 the search lacks. Only the shared card survives.
    const { result, requests } = await runWithFixtures(["search", "-q", "unity", "-c", "programming"], {
      "/search": "search-unity.html",
      "/remote-game-programming-jobs": "category-programming.html",
      "/feed.rss": "feed.rss",
    })
    expect(parseJSON<SearchOut>(result).results.map((r) => r.id)).toEqual(["skymap-games-multiplayer-engineer-unity-remote-job"])
    expect(requests.map((r) => r.pathname).sort()).toEqual(["/feed.rss", "/remote-game-programming-jobs", "/search"])
  })

  test("--location, --limit and the table/plain formats", async () => {
    const loc = parseJSON<SearchOut>((await runWithFixtures(["search", "-q", "unity", "-l", "europe"], SEARCH)).result)
    expect(loc.results.map((r) => r.company)).toEqual(["Hugecalf Studios"])
    const lim = parseJSON<SearchOut>((await runWithFixtures(["search", "-q", "unity", "--limit", "1"], SEARCH)).result)
    expect(lim.results).toHaveLength(1)
    expect((await runWithFixtures(["search", "-q", "unity", "--format", "table"], SEARCH)).result.stdout).toContain("Skymap Games")
    expect((await runWithFixtures(["search", "-q", "unity", "--format", "plain"], SEARCH)).result.stdout).toContain(
      "id: hugecalf-studios-systems-designer-remote-job",
    )
  })

  test("no matches skips the feed request", async () => {
    const { result, requests } = await runWithFixtures(["search", "-q", "zzz"], { "/search": "search-empty.html" })
    expect(parseJSON<SearchOut>(result).results).toEqual([])
    expect(requests.map((r) => r.pathname)).toEqual(["/search"])
  })

  test("a 404 search page is an empty list too (documented 404 behaviour)", async () => {
    const { result } = await runWithFixtures(["search", "-q", "zzz"], { "/search": 404 })
    expect(parseJSON<SearchOut>(result).results).toEqual([])
  })

  test("a failing feed leaves dates null without --jobage, and fails the search with it", async () => {
    const routes = { "/search": "search-unity.html", "/feed.rss": 403 }
    const { result } = await runWithFixtures(["search", "-q", "unity"], routes)
    const out = parseJSON<SearchOut & { meta: { feedError?: string } }>(result)
    expect(out.results.length).toBe(3)
    expect(out.results.every((r) => r.date === null)).toBe(true)
    expect(out.meta.feedError).toContain("403")
    expect(JSON.parse(result.stderr).code).toBe("FEED_UNAVAILABLE")
    const strict = await runWithFixtures(["search", "-q", "unity", "--jobage", "14"], routes)
    expect(strict.result.exitCode).toBe(1)
    expect(JSON.parse(strict.result.stderr).code).toBe("SEARCH_FAILED")
  })
})

describe("detail through the real CLI with saved responses", () => {
  const route = { "/jobs/skymap-games-multiplayer-engineer-unity-remote-job": "detail-skymap.html" }

  test("json carries scope, applicant location and description; /goto/ is never requested", async () => {
    const { result, requests } = await runWithFixtures(
      ["detail", "https://remotegamejobs.com/jobs/skymap-games-multiplayer-engineer-unity-remote-job"],
      route,
    )
    const job = parseJSON<Record<string, unknown>>(result)
    expect(job).toMatchObject({ applicantLocation: "Canada", deadline: "2026-11-29" })
    expect(String(job.description)).toContain("multiplayer functionality")
    expect(requests.map((r) => r.pathname)).toEqual(["/jobs/skymap-games-multiplayer-engineer-unity-remote-job"])
  })

  test("plain output is readable text", async () => {
    const { result } = await runWithFixtures(
      ["detail", "skymap-games-multiplayer-engineer-unity-remote-job", "--format", "plain"],
      route,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Remote scope: Must be based in the province of Quebec, Canada")
    expect(result.stdout).not.toContain("<div>")
    // Header, facts, description and URL stay separated by blank lines.
    expect(result.stdout).toMatch(/\n\nRemote scope:/)
    expect(result.stdout).toMatch(/\n\nURL: /)
  })

  test("a removed posting (404) is NOT_FOUND on stderr, exit 1", async () => {
    const { result } = await runWithFixtures(["detail", "gone-job"], { "/jobs/gone-job": 404 })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe("NOT_FOUND")
  })
})

describe("argument validation (no network)", () => {
  const cases: Array<[string, string[], string]> = [
    ["unknown flag", ["search", "-q", "unity", "--page", "2"], "UNKNOWN_FLAG"],
    ["empty query", ["search", "-q", ""], "BAD_ARG"],
    ["unknown category", ["search", "-c", "engineering"], "BAD_ARG"],
    ["fractional jobage", ["search", "--jobage", "1.5"], "BAD_ARG"],
    ["bad format", ["search", "--format", "csv"], "BAD_ARG"],
    ["detail without id", ["detail"], "NO_ID"],
    ["detail on the apply redirect", ["detail", "https://remotegamejobs.com/goto/some-job"], "BAD_ID"],
    ["unknown command", ["apply", "x"], "BAD_CMD"],
  ]
  test.each(cases)("%s exits 1 with a JSON error on stderr", async (_name, args, code) => {
    const result = await runCLI(args)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe(code)
  })

  test("--help prints usage and exits 0", async () => {
    const result = await runCLI(["search", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("remotegamejobs-cli")
  })
})
