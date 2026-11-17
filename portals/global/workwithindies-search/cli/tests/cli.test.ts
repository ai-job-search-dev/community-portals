import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI, runWithFixtures } from "./helpers.ts"

interface SearchOut {
  meta: { count: number; page: number; total: number; hasNext: boolean }
  results: Array<Record<string, unknown>>
}

const FEED = { "/careers/rss.xml": "feed.xml" }

describe("search through the real CLI with saved responses", () => {
  test("feed search returns the contract shape with every field present", async () => {
    const { result, requests } = await runWithFixtures(["search"], FEED)
    const out = parseJSON<SearchOut>(result)
    expect(out.meta).toMatchObject({ count: 4, page: 1, total: 4, hasNext: false })
    for (const r of out.results) {
      for (const key of ["id", "title", "company", "location", "date", "url"]) expect(r).toHaveProperty(key)
    }
    expect(requests.map((r) => r.pathname)).toEqual(["/careers/rss.xml"])
  })

  test("--query and --location filter client-side", async () => {
    const q = parseJSON<SearchOut>((await runWithFixtures(["search", "-q", "programmer"], FEED)).result)
    expect(q.results.map((r) => r.id)).toEqual(["creature-unity-gameplay-tools-programmer", "42-bits-mission-programmer"])
    const l = parseJSON<SearchOut>((await runWithFixtures(["search", "-l", "anywhere"], FEED)).result)
    expect(l.results.map((r) => r.id)).toEqual(["veelpoot-quest-designer"])
  })

  test("--category filters the feed by tag and fetches nothing else", async () => {
    const { result, requests } = await runWithFixtures(["search", "-c", "programming"], FEED)
    const out = parseJSON<SearchOut>(result)
    expect(out.results.map((r) => r.id)).toEqual(["creature-unity-gameplay-tools-programmer", "42-bits-mission-programmer"])
    expect(requests.map((r) => r.pathname)).toEqual(["/careers/rss.xml"])
  })

  test("--limit caps output and table/plain render", async () => {
    const limited = parseJSON<SearchOut>((await runWithFixtures(["search", "--limit", "1"], FEED)).result)
    expect(limited.results).toHaveLength(1)
    const table = await runWithFixtures(["search", "--format", "table"], FEED)
    expect(table.result.stdout).toContain("Creature")
    const plain = await runWithFixtures(["search", "--format", "plain"], FEED)
    expect(plain.result.stdout).toContain("id: veelpoot-quest-designer")
  })

  test("a missing feed (404) yields an empty list, not a crash", async () => {
    const { result } = await runWithFixtures(["search"], { "/careers/rss.xml": 404 })
    expect(parseJSON<SearchOut>(result).results).toEqual([])
  })
})

describe("detail through the real CLI with saved responses", () => {
  test("json is the feed entry, looked up by URL, without fetching the posting page", async () => {
    const { result, requests } = await runWithFixtures(
      ["detail", "https://www.workwithindies.com/careers/creature-unity-gameplay-tools-programmer"],
      FEED,
    )
    const job = parseJSON<Record<string, unknown>>(result)
    expect(job).toMatchObject({ id: "creature-unity-gameplay-tools-programmer", company: "Creature", employmentType: "Contract" })
    expect(String(job.description)).toStartWith("Creature is seeking a contract")
    expect(requests.map((r) => r.pathname)).toEqual(["/careers/rss.xml"])
  })

  test("plain output says it is the feed summary", async () => {
    const { result } = await runWithFixtures(["detail", "veelpoot-quest-designer", "--format", "plain"], FEED)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Feed summary only")
    expect(result.stdout).toContain("Tags: Design, Freelance")
  })

  test("a posting not in the feed is NOT_FOUND on stderr, exit 1", async () => {
    const { result } = await runWithFixtures(["detail", "gone-job"], FEED)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe("NOT_FOUND")
  })
})

describe("argument validation (no network)", () => {
  const cases: Array<[string, string[], string]> = [
    ["unknown flag", ["search", "--remote", "remote"], "UNKNOWN_FLAG"],
    ["empty query", ["search", "-q", ""], "BAD_ARG"],
    ["unknown category", ["search", "-c", "engineering"], "BAD_ARG"],
    ["fractional jobage", ["search", "--jobage", "1.5"], "BAD_ARG"],
    ["zero limit", ["search", "--limit", "0"], "BAD_ARG"],
    ["bad format", ["search", "--format", "csv"], "BAD_ARG"],
    ["detail without id", ["detail"], "NO_ID"],
    ["detail on another host", ["detail", "https://docs.google.com/forms/x"], "BAD_ID"],
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
    expect(result.stdout).toContain("workwithindies-cli")
  })
})
