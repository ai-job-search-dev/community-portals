import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { parseJSON, runCLI, runWithFixture } from "./helpers.ts"

interface SearchOut {
  meta: { count: number; page: number; total: number | null; hasNext: boolean }
  results: Array<Record<string, unknown>>
}

const isSearch = (u: URL) => u.pathname === "/search"
const isDetail = (u: URL) => u.pathname === "/Gameplay-Programmer-Senior-Unity-at-Old-Skull-Games-2652"

describe("search through the real CLI with a saved response", () => {
  test("returns the contract shape with every field present", async () => {
    const { result, requests } = await runWithFixture(["search", "-q", "unity"], "search-unity.html", isSearch)
    const out = parseJSON<SearchOut>(result)
    expect(out.meta).toMatchObject({ count: 3, page: 1, total: 1083, hasNext: true })
    for (const r of out.results) {
      for (const key of ["id", "title", "company", "location", "date", "url"]) expect(r).toHaveProperty(key)
    }
    expect(out.results[2]).toMatchObject({
      id: "Lead-Unity-Developer-at-Aristocrat-4757",
      title: "Lead Unity Developer",
      url: "https://gamejobs.co/Lead-Unity-Developer-at-Aristocrat-4757",
    })
    expect(requests).toHaveLength(1)
    expect(requests[0].searchParams.get("q")).toBe("unity")
  })

  test("maps --location, --jobage and --page onto the board's parameters", async () => {
    const { result, requests } = await runWithFixture(
      ["search", "-q", "unity", "-l", "Remote", "--jobage", "14", "--page", "2", "--limit", "1"],
      "search-unity.html",
      isSearch,
    )
    expect(parseJSON<SearchOut>(result).results.length).toBeLessThanOrEqual(1)
    const params = requests[0].searchParams
    expect(params.get("w")).toBe("Remote")
    expect(params.get("a")).toBe("31d")
    expect(params.get("p")).toBe("2")
  })

  test("--jobage drops cards older than the window and keeps undated ones", async () => {
    // Fixture ages: 7 days, 10 days, 1 month. A copy turns the 10-day card's age
    // into text the parser cannot read, so it has no date.
    const undated = join(import.meta.dir, "fixtures", "search-unity-undated.tmp.html")
    writeFileSync(undated, readFileSync(join(import.meta.dir, "fixtures", "search-unity.html"), "utf8").replace("10 days ago", "recently"))
    try {
      const { result } = await runWithFixture(["search", "-q", "unity", "--jobage", "8"], "search-unity-undated.tmp.html", isSearch)
      const out = parseJSON<SearchOut>(result)
      const ages = out.results.map((r) => r.dateText)
      expect(ages).toContain("7 days ago")
      expect(ages).toContain(null)
      expect(ages).not.toContain("1 month ago")
    } finally {
      rmSync(undated, { force: true })
    }
  })

  test("table and plain formats render", async () => {
    const table = await runWithFixture(["search", "-q", "unity", "--format", "table"], "search-unity.html", isSearch)
    expect(table.result.exitCode).toBe(0)
    expect(table.result.stdout).toContain("Old Skull Games")
    const plain = await runWithFixture(["search", "-q", "unity", "--format", "plain"], "search-unity.html", isSearch)
    expect(plain.result.stdout).toContain("id: Lead-Unity-Developer-at-Aristocrat-4757")
  })

  test("a 404 search page yields an empty result list, not a crash", async () => {
    const { result } = await runWithFixture(["search", "-q", "unity"], "search-unity.html", isSearch, 404)
    expect(result.exitCode).toBe(0)
    expect(parseJSON<SearchOut>(result).results).toEqual([])
  })
})

describe("detail through the real CLI with a saved response", () => {
  test("json carries the description and posting fields", async () => {
    const { result, requests } = await runWithFixture(
      ["detail", "https://gamejobs.co/Gameplay-Programmer-Senior-Unity-at-Old-Skull-Games-2652"],
      "detail-old-skull.html",
      isDetail,
    )
    const job = parseJSON<Record<string, unknown>>(result)
    expect(job.title).toBe("Gameplay Programmer Senior Unity")
    expect(job.deadline).toBe("2027-05-15")
    expect(String(job.description)).toContain("Excellente maîtrise d’Unity (C#)")
    expect(requests.map((r) => r.pathname)).toEqual(["/Gameplay-Programmer-Senior-Unity-at-Old-Skull-Games-2652"])
  })

  test("plain output is readable text", async () => {
    const { result } = await runWithFixture(
      ["detail", "Gameplay-Programmer-Senior-Unity-at-Old-Skull-Games-2652", "--format", "plain"],
      "detail-old-skull.html",
      isDetail,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Old Skull Games · Villeurbanne, France")
    expect(result.stdout).toContain("Valid through: 2027-05-15")
    // Header, facts, description and URL stay separated by blank lines.
    expect(result.stdout).toMatch(/Villeurbanne, France\n\nPosted:/)
    expect(result.stdout).toMatch(/\n\nURL: /)
    expect(result.stdout).not.toContain("<p>")
  })

  test("a removed posting (404) is NOT_FOUND on stderr, exit 1", async () => {
    const { result } = await runWithFixture(
      ["detail", "Gameplay-Programmer-Senior-Unity-at-Old-Skull-Games-2652"],
      "detail-old-skull.html",
      isDetail,
      404,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe("NOT_FOUND")
  })
})

describe("argument validation (no network)", () => {
  const cases: Array<[string, string[], string]> = [
    ["unknown flag", ["search", "-q", "unity", "--remote", "remote"], "UNKNOWN_FLAG"],
    ["empty query", ["search", "-q", ""], "BAD_ARG"],
    ["bare query flag", ["search", "-q"], "BAD_ARG"],
    ["fractional jobage", ["search", "--jobage", "0.5"], "BAD_ARG"],
    ["zero page", ["search", "--page", "0"], "BAD_ARG"],
    ["bad format", ["search", "--format", "csv"], "BAD_ARG"],
    ["detail without id", ["detail"], "NO_ID"],
    ["detail on another host", ["detail", "https://jobs.smartrecruiters.com/x/123"], "BAD_ID"],
    ["detail table format", ["detail", "Some-Job", "--format", "table"], "BAD_ARG"],
    ["unknown command", ["apply", "Some-Job"], "BAD_CMD"],
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
    expect(result.stdout).toContain("gamejobs-cli")
  })
})
