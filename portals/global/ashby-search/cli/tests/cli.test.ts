// End-to-end CLI tests, offline: requests go to saved fixtures (tests/fixtures/), never the network.
import "./no-network.ts"
import { describe, expect, test } from "bun:test"
import { join } from "path"
import { parseJSON, runCLI, runCLIWithFixtures, type Routes } from "./helpers.ts"

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", name)).text()
const HOSTS = ["api.ashbyhq.com", "jobs.ashbyhq.com"]
const PM = "aaaaaaaa-0000-4000-8000-000000000001"

async function routes(): Promise<Routes> {
  return {
    "api.ashbyhq.com/posting-api/job-board/acme": { body: await fixture("board.json") },
    "jobs.ashbyhq.com/acme": { body: await fixture("board-page.html") },
  }
}

interface SearchOut {
  meta: { count: number; page: number; matched: number; boards: { board: string; company: string | null; total: number | null; error: string | null }[] }
  results: { id: string; title: string; url: string; company: string | null; location: string | null; date: string | null; salary: string | null }[]
}

describe("search", () => {
  test("returns listed jobs with the contract fields and the company name, newest first", async () => {
    const { result, requests } = await runCLIWithFixtures(["search", "-b", "acme"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(requests[0].searchParams.get("includeCompensation")).toBe("true")
    expect(out.meta.boards).toEqual([{ board: "acme", company: "Acme Robotics", total: 3, error: null }])
    expect(out.results.map((r) => r.title)).toEqual(["Staff Software Engineer", "Product Designer", "Senior Product Manager, Platform"])
    for (const r of out.results) {
      for (const k of ["id", "title", "company", "location", "date", "url"]) expect(k in r).toBe(true)
      expect(r.company).toBe("Acme Robotics")
    }
    expect(out.results[2].salary).toBe("$150K - $190K")
  })

  test("--remote remote matches workplaceType and remote secondary locations", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "acme", "-q", "product", "--remote", "remote"], await routes(), HOSTS)
    expect(parseJSON<SearchOut>(result).results.map((r) => r.title)).toEqual(["Product Designer", "Senior Product Manager, Platform"])
  })

  test("an unknown board in a multi-board search is reported, the others still return", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "acme,no-such-board"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(out.meta.boards[1]).toEqual({ board: "no-such-board", company: null, total: null, error: "BOARD_NOT_FOUND" })
    expect(out.results.length).toBe(3)
  })

  test("table output warns on stderr about a skipped board and still exits 0", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "acme,no-such-board", "--format", "table"], await routes(), HOSTS)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Senior Product Manager, Platform")
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "BOARD_NOT_FOUND" })
  })

  test("a board that keeps failing is reported, the others still return", async () => {
    const r = { ...(await routes()), "api.ashbyhq.com/posting-api/job-board/flaky": { body: "", status: 400 } }
    const { result } = await runCLIWithFixtures(["search", "-b", "acme,flaky"], r, HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(out.meta.boards[1]).toEqual({ board: "flaky", company: null, total: null, error: "FETCH_FAILED" })
    expect(out.results.length).toBe(3)
  })

  test("every board failing exits 1", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "nope-a,nope-b"], await routes(), HOSTS)
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BOARD_NOT_FOUND")
  })

  test("a single unknown board exits 1 with BOARD_NOT_FOUND", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "no-such-board"], await routes(), HOSTS)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe("BOARD_NOT_FOUND")
  })
})

describe("detail", () => {
  test("board URL returns readable text without the hidden element, plus pay", async () => {
    const { result } = await runCLIWithFixtures(["detail", `https://jobs.ashbyhq.com/acme/${PM}`], await routes(), HOSTS)
    const d = parseJSON<{ id: string; company: string; description: string; pay: { type: string; interval: string; currency: string; min: number; max: number }[] }>(result)
    expect(d.id).toBe(PM)
    expect(d.company).toBe("Acme Robotics")
    expect(d.description).toBe("About Acme\nAcme builds warehouse robots.\n\n- Own the platform roadmap\n- Work with engineering — daily")
    expect(d.pay).toEqual([{ type: "Salary", interval: "1 YEAR", currency: "USD", min: 150000, max: 190000 }])
  })

  test("a careers-page ashby_jid URL works with --board, in plain format", async () => {
    const { result } = await runCLIWithFixtures(
      ["detail", `https://www.example.com/careers/?ashby_jid=${PM}`, "-b", "acme", "--format", "plain"],
      await routes(),
      HOSTS,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Pay: USD 150,000 - USD 190,000 (1 year)")
    expect(result.stdout).toContain("Status: ACTIVE")
  })

  test("a job not on the board exits 1 with NOT_FOUND", async () => {
    const { result } = await runCLIWithFixtures(["detail", "aaaaaaaa-0000-4000-8000-000000000099", "-b", "acme"], await routes(), HOSTS)
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("NOT_FOUND")
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
  test("bad board slug", () => expectError(["search", "-b", "../etc"], "BAD_ARG"))
  test("bad --remote", () => expectError(["search", "-b", "acme", "--remote", "moon"], "BAD_ARG"))
  test("fractional --jobage", () => expectError(["search", "-b", "acme", "--jobage", "0.5"], "BAD_ARG"))
  test("bare id without --board", () => expectError(["detail", PM], "BAD_ID"))
  test("ashby_jid URL without --board", () => expectError(["detail", `https://www.example.com/careers/?ashby_jid=${PM}`], "BAD_ID"))
  test("foreign URL", () => expectError(["detail", "https://www.linkedin.com/jobs/view/1234567890"], "BAD_ID"))
  test("detail with two boards", () => expectError(["detail", "x", "-b", "a,b"], "BAD_ARG"))
  test("repeated flag, including via its alias", () => expectError(["search", "-b", "acme", "--board", "other"], "BAD_ARG"))
  test("inherited object key is not a command", () => expectError(["constructor", "-b", "acme"], "BAD_CMD"))
  test("URL board conflicting with --board", async () => {
    const r = await runCLI(["detail", `https://jobs.ashbyhq.com/acme/${PM}`, "-b", "other"])
    const err = JSON.parse(r.stderr)
    expect(err.code).toBe("BAD_ID")
    expect(err.error).toContain('on board "acme" but --board is "other"')
  })
})
