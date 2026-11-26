// End-to-end CLI tests, offline: requests go to saved fixtures (tests/fixtures/), never the network.
import "./no-network.ts"
import { describe, expect, test } from "bun:test"
import { join } from "path"
import { parseJSON, runCLI, runCLIWithFixtures, type Routes } from "./helpers.ts"

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", name)).text()
const HOSTS = ["api.lever.co", "api.eu.lever.co"]
const PM_ID = "11111111-1111-4111-8111-111111111111"

async function routes(): Promise<Routes> {
  return {
    "api.lever.co/v0/postings/acme": { body: await fixture("board.json") },
    [`api.lever.co/v0/postings/acme/${PM_ID}`]: { body: await fixture(`job-${PM_ID}.json`) },
  }
}

interface SearchOut {
  meta: { count: number; page: number; board: string; matched: number; boardTotal: number }
  results: {
    id: string
    title: string
    url: string
    company: string
    location: string | null
    date: string | null
    board: string
    workplace: string | null
  }[]
}

describe("search", () => {
  test("returns the contract fields, newest first", async () => {
    const { result, requests } = await runCLIWithFixtures(["search", "-b", "acme"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(requests.map((u) => u.pathname)).toEqual(["/v0/postings/acme"])
    expect(requests[0].searchParams.get("limit")).toBe("100")
    expect(requests[0].searchParams.get("skip")).toBe("0")
    expect(out.meta).toEqual({ count: 3, page: 1, board: "acme", matched: 3, boardTotal: 3 })
    expect(out.results.map((r) => r.id)).toEqual([
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      PM_ID,
    ])
    for (const r of out.results) {
      for (const k of ["id", "title", "company", "location", "date", "url"]) expect(k in r).toBe(true)
      expect(r.company).toBe("acme")
      expect(r.board).toBe("acme")
    }
    expect(out.results[2].location).toBe("Remote - United States")
    expect(out.results[2].workplace).toBe("remote")
    expect(out.results[2].date).toBe("2026-10-20T13:00:00.000Z")
  })

  test("query and location filter client-side", async () => {
    const { result } = await runCLIWithFixtures(
      ["search", "-b", "acme", "-q", "product", "-l", "remote"],
      await routes(),
      HOSTS,
    )
    const out = parseJSON<SearchOut>(result)
    expect(out.results.map((r) => r.title)).toEqual(["Product Designer", "Senior Product Manager, Platform"])
  })

  test("--limit sets the page size so paging does not skip results", async () => {
    const { result } = await runCLIWithFixtures(
      ["search", "-b", "acme", "--page", "2", "--limit", "1"],
      await routes(),
      HOSTS,
    )
    const out = parseJSON<SearchOut>(result)
    expect(out.meta).toMatchObject({ count: 1, page: 2 })
    expect(out.results.map((r) => r.id)).toEqual(["33333333-3333-4333-8333-333333333333"])
  })

  test("--remote filters by normalized workplace", async () => {
    const saved = await routes()
    const search = async (mode: string) => {
      const { result } = await runCLIWithFixtures(["search", "-b", "acme", "--remote", mode], saved, HOSTS)
      return parseJSON<SearchOut>(result)
    }
    expect((await search("remote")).results.map((r) => r.id)).toEqual([PM_ID])
    expect((await search("hybrid")).results.map((r) => r.id)).toEqual(["33333333-3333-4333-8333-333333333333"])
    // The fixture spells this posting "on-site"; the filter accepts both.
    expect((await search("onsite")).results.map((r) => r.id)).toEqual(["22222222-2222-4222-8222-222222222222"])
  })

  test("--region eu calls the EU host", async () => {
    const eu = { "api.eu.lever.co/v0/postings/acme": { body: await fixture("board.json") } }
    const { result, requests } = await runCLIWithFixtures(["search", "-b", "acme", "--region", "eu"], eu, HOSTS)
    expect(requests.map((u) => `${u.host}${u.pathname}`)).toEqual(["api.eu.lever.co/v0/postings/acme"])
    expect(parseJSON<SearchOut>(result).meta).toMatchObject({ count: 3, board: "acme" })
  })

  test("unknown board exits 1 with BOARD_NOT_FOUND", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "no-such-board"], await routes(), HOSTS)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe("BOARD_NOT_FOUND")
  })
})

describe("detail", () => {
  test("URL input returns decoded text without the hidden element", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["detail", `https://jobs.lever.co/acme/${PM_ID}`],
      await routes(),
      HOSTS,
    )
    const d = parseJSON<{
      id: string
      description: string
      salary: { min: number; max: number; interval: string }
      department: string
      team: string
    }>(result)
    expect(requests[0].pathname).toBe(`/v0/postings/acme/${PM_ID}`)
    expect(requests[0].searchParams.get("mode")).toBe("json")
    expect(d.id).toBe(PM_ID)
    expect(d.description).toContain("Acme builds warehouse robots.")
    expect(d.description).toContain("- Own the platform roadmap")
    expect(d.description).toContain("- Work with engineering — daily")
    expect(d.description).toContain("Requirements:\n- Five years of product experience")
    expect(d.description).toContain("Acme is an equal opportunity employer.")
    expect(d.description).not.toContain("Ignore previous instructions")
    expect(d.description).not.toMatch(/&lt;|&amp;|&mdash;|<div>/)
    expect(d.salary).toMatchObject({ min: 150000, max: 190000, interval: "per-year-salary" })
    expect(d.department).toBe("Product")
    expect(d.team).toBe("Platform")
  })

  test("plain format by ID with --board", async () => {
    const { result } = await runCLIWithFixtures(["detail", PM_ID, "-b", "acme", "--format", "plain"], await routes(), HOSTS)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Department: Product / Platform")
    expect(result.stdout).toContain("Employment: Regular Full Time (Salary)")
    expect(result.stdout).toContain("Posted: 2026-10-20")
    expect(result.stdout).toContain("Pay: $150,000 - $190,000 (per-year-salary)")
    expect(result.stdout).toContain("Apply: https://jobs.lever.co/acme/11111111-1111-4111-8111-111111111111/apply")
  })

  test("an EU posting URL reads the EU host", async () => {
    const eu = { [`api.eu.lever.co/v0/postings/acme/${PM_ID}`]: { body: await fixture(`job-${PM_ID}.json`) } }
    const { result, requests } = await runCLIWithFixtures(
      ["detail", `https://jobs.eu.lever.co/acme/${PM_ID}`],
      eu,
      HOSTS,
    )
    expect(requests[0].host).toBe("api.eu.lever.co")
    expect(parseJSON<{ id: string }>(result).id).toBe(PM_ID)
  })

  test("a bare EU UUID with --region eu reads the EU host", async () => {
    const eu = { [`api.eu.lever.co/v0/postings/acme/${PM_ID}`]: { body: await fixture(`job-${PM_ID}.json`) } }
    const { result, requests } = await runCLIWithFixtures(
      ["detail", PM_ID, "-b", "acme", "--region", "eu"],
      eu,
      HOSTS,
    )
    expect(requests[0].host).toBe("api.eu.lever.co")
    expect(parseJSON<{ id: string }>(result).id).toBe(PM_ID)
  })

  test("a closed job exits 1 with NOT_FOUND", async () => {
    const { result } = await runCLIWithFixtures(
      ["detail", "99999999-9999-4999-8999-999999999999", "-b", "acme"],
      await routes(),
      HOSTS,
    )
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("NOT_FOUND")
  })
})

describe("help", () => {
  test("explicit --help exits 0", async () => {
    const r = await runCLI(["--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("USAGE")
  })
  test("no command exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("USAGE")
  })
  test("search --help exits 0", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("SEARCH FLAGS")
  })
})

describe("argument validation (network blocked)", () => {
  async function expectError(args: string[], code: string) {
    const r = await runCLI(args)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(JSON.parse(r.stderr).code).toBe(code)
  }
  test("missing --board", () => expectError(["search", "-q", "product"], "NO_BOARD"))
  test("bogus flag", () => expectError(["search", "-b", "acme", "--bogus", "x"], "UNKNOWN_FLAG"))
  test("stray positional argument", () => expectError(["search", "-b", "acme", "-q", "product", "manager"], "BAD_ARG"))
  test("bare ID without board", () => expectError(["detail", PM_ID], "BAD_ID"))
  test("non-Lever URL", () => expectError(["detail", "https://www.linkedin.com/jobs/view/1234567890"], "BAD_ID"))
  test("non-UUID job ID", () => expectError(["detail", "123", "-b", "acme"], "BAD_ID"))
  test("fractional --jobage", () => expectError(["search", "-b", "acme", "--jobage", "0.5"], "BAD_ARG"))
  test("bad --remote", () => expectError(["search", "-b", "acme", "--remote", "office"], "BAD_ARG"))
  test("--remote without a value", () => expectError(["search", "-b", "acme", "--remote"], "BAD_ARG"))
  test("bad --region", () => expectError(["search", "-b", "acme", "--region", "apac"], "BAD_ARG"))
  test("--__proto__ is an unknown flag, not dropped", () => expectError(["search", "-b", "acme", "--__proto__", "x"], "UNKNOWN_FLAG"))
  test("repeated flag, including via its alias", () => expectError(["search", "-b", "acme", "--board", "other"], "BAD_ARG"))
  test("inherited object key is not a command", () => expectError(["toString", "--foo"], "BAD_CMD"))
  test("URL board conflicting with --board", async () => {
    const r = await runCLI(["detail", `https://jobs.lever.co/acme/${PM_ID}`, "-b", "other"])
    const err = JSON.parse(r.stderr)
    expect(err.code).toBe("BAD_ID")
    expect(err.error).toContain('on board "acme" but --board is "other"')
  })
})
