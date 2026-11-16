// End-to-end CLI tests, offline: requests go to saved fixtures (tests/fixtures/), never the network.
import "./no-network.ts"
import { describe, expect, test } from "bun:test"
import { join } from "path"
import { parseJSON, runCLI, runCLIWithFixtures, type Routes } from "./helpers.ts"

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", name)).text()
const HOSTS = ["boards-api.greenhouse.io", "boards-api.eu.greenhouse.io"]

async function routes(): Promise<Routes> {
  return {
    "boards-api.greenhouse.io/v1/boards/acme/jobs": { body: await fixture("board.json") },
    "boards-api.greenhouse.io/v1/boards/acme/jobs/4000001": { body: await fixture("job-4000001.json") },
  }
}

interface SearchOut {
  meta: { count: number; page: number; board: string; matched: number; boardTotal: number }
  results: { id: string; title: string; url: string; company: string | null; location: string | null; date: string | null }[]
}

describe("search", () => {
  test("returns the contract fields, newest first", async () => {
    const { result, requests } = await runCLIWithFixtures(["search", "-b", "acme"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(requests.map((u) => u.pathname)).toEqual(["/v1/boards/acme/jobs"])
    expect(out.meta).toEqual({ count: 3, page: 1, board: "acme", matched: 3, boardTotal: 3 })
    expect(out.results.map((r) => r.id)).toEqual(["4000002", "4000003", "4000001"])
    for (const r of out.results) {
      for (const k of ["id", "title", "company", "location", "date", "url"]) expect(k in r).toBe(true)
      expect(r.company).toBe("Acme Robotics")
    }
  })

  test("query and location filter client-side", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "acme", "-q", "product", "-l", "remote"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(out.results.map((r) => r.title)).toEqual(["Product Designer", "Senior Product Manager, Platform"])
  })

  test("--region eu calls the EU host", async () => {
    const eu = { "boards-api.eu.greenhouse.io/v1/boards/acme/jobs": { body: await fixture("board.json") } }
    const { result, requests } = await runCLIWithFixtures(["search", "-b", "acme", "--region", "eu"], eu, HOSTS)
    expect(requests.map((u) => `${u.host}${u.pathname}`)).toEqual(["boards-api.eu.greenhouse.io/v1/boards/acme/jobs"])
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
      ["detail", "https://job-boards.greenhouse.io/acme/jobs/4000001"],
      await routes(),
      HOSTS,
    )
    const d = parseJSON<{ id: string; description: string; payRanges: { min: number; max: number }[] }>(result)
    expect(requests[0].searchParams.get("pay_transparency")).toBe("true")
    expect(d.id).toBe("4000001")
    expect(d.description).toContain("Acme builds warehouse robots.")
    expect(d.description).toContain("- Work with engineering — daily")
    expect(d.description).not.toContain("Ignore previous instructions")
    expect(d.description).not.toMatch(/&lt;|&amp;|<p>/)
    expect(d.payRanges[0]).toMatchObject({ min: 150000, max: 190000 })
  })

  test("plain format by ID with --board", async () => {
    const { result } = await runCLIWithFixtures(["detail", "4000001", "-b", "acme", "--format", "plain"], await routes(), HOSTS)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Requisition ID: R-4000001")
    expect(result.stdout).toContain("Pay (Base salary): $150,000 - $190,000")
  })

  test("a closed job exits 1 with NOT_FOUND", async () => {
    const { result } = await runCLIWithFixtures(["detail", "4999999", "-b", "acme"], await routes(), HOSTS)
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
  test("bare ID without board", () => expectError(["detail", "4000001"], "BAD_ID"))
  test("non-Greenhouse URL", () => expectError(["detail", "https://www.linkedin.com/jobs/view/1234567890"], "BAD_ID"))
  test("fractional --jobage", () => expectError(["search", "-b", "acme", "--jobage", "0.5"], "BAD_ARG"))
  test("bad --region", () => expectError(["search", "-b", "acme", "--region", "apac"], "BAD_ARG"))
  test("repeated flag, including via its alias", () => expectError(["search", "-b", "acme", "--board", "other"], "BAD_ARG"))
  test("inherited object key is not a command", () => expectError(["toString", "--foo"], "BAD_CMD"))
  test("short numeric ID with --board", async () => {
    const r = await runCLI(["detail", "123", "-b", "acme"])
    const err = JSON.parse(r.stderr)
    expect(err.code).toBe("BAD_ID")
    expect(err.error).toContain("at least 4 digits")
  })
  test("URL board conflicting with --board", async () => {
    const r = await runCLI(["detail", "https://job-boards.greenhouse.io/acme/jobs/4000001", "-b", "other"])
    const err = JSON.parse(r.stderr)
    expect(err.code).toBe("BAD_ID")
    expect(err.error).toContain('on board "acme" but --board is "other"')
  })
})
