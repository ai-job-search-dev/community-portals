// End-to-end CLI tests, offline: requests go to saved fixtures (tests/fixtures/), never the network.
import "./no-network.ts"
import { describe, expect, test } from "bun:test"
import { join } from "path"
import { parseJSON, runCLI, runCLIWithFixtures, type Routes } from "./helpers.ts"

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", name)).text()
const HOSTS = ["careers-usu.icims.com"]
const JOB_PATH = "/jobs/11021/biology-teaching-assistant/job"
const JOB_URL = `https://careers-usu.icims.com${JOB_PATH}`

async function routes(): Promise<Routes> {
  const search = await fixture("search-page.html")
  return {
    "careers-usu.icims.com/jobs/search": { body: search },
    [`careers-usu.icims.com${JOB_PATH}`]: { body: await fixture("job-11021.html") },
    "careers-usu.icims.com/jobs/11021/job": { body: await fixture("job-11021.html") },
  }
}

interface SearchOut {
  meta: { count: number; page: number; portal: string; matched: number; totalPages: number | null }
  results: {
    id: string
    title: string
    company: string
    location: string | null
    date: string | null
    url: string
    workplace: string | null
  }[]
}

describe("search", () => {
  test("returns the contract fields", async () => {
    const { result, requests } = await runCLIWithFixtures(["search", "-p", "careers-usu"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(requests.map((u) => u.pathname)).toEqual(["/jobs/search"])
    expect(out.meta).toEqual({ count: 3, page: 1, portal: "careers-usu", matched: 3, totalPages: 3 })
    expect(out.results.map((r) => r.id)).toEqual(["11021", "11022", "44360"])
    for (const r of out.results) {
      for (const k of ["id", "title", "company", "location", "date", "url"]) expect(k in r).toBe(true)
      expect(r.company).toBe("careers-usu")
    }
    expect(out.results[0]).toEqual({
      id: "11021",
      title: "Biology Teaching Assistant & Lab Aide",
      company: "careers-usu",
      location: "US-UT-Brigham City",
      date: "2026-11-25",
      url: `https://careers-usu.icims.com${JOB_PATH}`,
      workplace: "hybrid",
    })
    expect(out.results[1]).toMatchObject({ location: "Logan Campus", date: null, workplace: null })
    expect(out.results[2]).toMatchObject({
      url: "https://externalcareers-ohsu.icims.com/jobs/44360/rn%2c-nurse-navigator/job",
      location: "US-Remote",
      workplace: "remote",
    })
  })

  test("the keyword and page go to iCIMS's own search", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["search", "-p", "careers-usu", "-q", "registered nurse", "--page", "2"],
      await routes(),
      HOSTS,
    )
    parseJSON(result)
    expect(requests[0].searchParams.get("searchKeyword")).toBe("registered nurse")
    expect(requests[0].searchParams.get("searchRelation")).toBe("keyword_all")
    expect(requests[0].searchParams.get("pr")).toBe("1")
  })

  test("a portal URL works as well as a host label", async () => {
    const { result } = await runCLIWithFixtures(
      ["search", "--portal", "https://careers-usu.icims.com/jobs/search?ss=1"],
      await routes(),
      HOSTS,
    )
    expect(parseJSON<SearchOut>(result).meta.portal).toBe("careers-usu")

    const homepage = await runCLIWithFixtures(
      ["search", "--portal", "https://careers-usu.icims.com/"],
      await routes(),
      HOSTS,
    )
    expect(parseJSON<SearchOut>(homepage.result).meta.portal).toBe("careers-usu")
  })

  test("location filters the page, and jobage keeps undated cards", async () => {
    const byLocation = await runCLIWithFixtures(["search", "-p", "careers-usu", "-l", "brigham"], await routes(), HOSTS)
    expect(parseJSON<SearchOut>(byLocation.result).results.map((r) => r.id)).toEqual(["11021"])

    // 100 years: the dated card passes, and the undated cards stay because a
    // date filter cannot judge them - dropping them would empty whole portals.
    const byAge = await runCLIWithFixtures(["search", "-p", "careers-usu", "--jobage", "36500"], await routes(), HOSTS)
    expect(parseJSON<SearchOut>(byAge.result).results.map((r) => r.id)).toEqual(["11021", "11022", "44360"])
  })

  test("--remote filters by the portal's declared workplace", async () => {
    const hybrid = await runCLIWithFixtures(["search", "-p", "careers-usu", "--remote", "hybrid"], await routes(), HOSTS)
    expect(parseJSON<SearchOut>(hybrid.result).results.map((r) => r.id)).toEqual(["11021"])

    const remote = await runCLIWithFixtures(["search", "-p", "careers-usu", "--remote", "remote"], await routes(), HOSTS)
    expect(parseJSON<SearchOut>(remote.result).results.map((r) => r.id)).toEqual(["44360"])

    // No card declares on-site, so nothing can match it.
    const onsite = await runCLIWithFixtures(["search", "-p", "careers-usu", "--remote", "onsite"], await routes(), HOSTS)
    expect(parseJSON<SearchOut>(onsite.result).results).toEqual([])
  })

  test("--limit caps the page after filtering", async () => {
    const { result } = await runCLIWithFixtures(["search", "-p", "careers-usu", "--limit", "1"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(out.meta).toMatchObject({ count: 1, matched: 3 })
    expect(out.results).toHaveLength(1)
  })

  test("table and plain formats", async () => {
    const table = await runCLIWithFixtures(["search", "-p", "careers-usu", "--format", "table"], await routes(), HOSTS)
    expect(table.result.stdout.split("\n")[0]).toStartWith("TITLE")
    expect(table.result.stdout).toContain("WORKPLACE")
    expect(table.result.stdout).toContain("Biology Teaching Assistant")
    expect(table.result.stdout).toContain("hybrid")

    const plain = await runCLIWithFixtures(["search", "-p", "careers-usu", "--format", "plain"], await routes(), HOSTS)
    expect(plain.result.stdout).toContain("id: 11021")
    expect(plain.result.stdout).toContain("· hybrid")
    expect(plain.result.stdout).toContain(`https://careers-usu.icims.com${JOB_PATH}`)
  })

  test("a 200 without iCIMS markup fails instead of reading as an empty board", async () => {
    const blocked = { "careers-usu.icims.com/jobs/search": { body: "<html><body>Access denied</body></html>" } }
    const { result } = await runCLIWithFixtures(["search", "-p", "careers-usu"], blocked, HOSTS)
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("SEARCH_FAILED")
  })

  test("an unknown portal exits 1 with PORTAL_NOT_FOUND", async () => {
    const { result } = await runCLIWithFixtures(["search", "-p", "careers-nope"], {}, [...HOSTS, "careers-nope.icims.com"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe("PORTAL_NOT_FOUND")
  })
})

describe("detail", () => {
  test("URL input returns the posting, cleaned", async () => {
    const { result, requests } = await runCLIWithFixtures(["detail", `${JOB_URL}?in_iframe=1`], await routes(), HOSTS)
    const d = parseJSON<{
      id: string
      title: string
      location: string
      date: string
      description: string
      employmentType: string | null
      requisitionId: string
      url: string
      workplace: string | null
    }>(result)
    expect(requests[0].pathname).toBe(JOB_PATH)
    expect(requests[0].searchParams.get("in_iframe")).toBe("1")
    expect(d).toMatchObject({
      id: "11021",
      title: "Biology Teaching Assistant",
      location: "Brigham City, UT, US",
      date: "2026-11-25",
      employmentType: null,
      requisitionId: "2026-11021",
      url: JOB_URL,
      workplace: "hybrid",
    })
    expect(d.description).toContain("The Biology Teaching Assistant supports students.")
    expect(d.description).toContain("- Sanitize & clean laboratory.")
    expect(d.description).not.toContain("Ignore previous instructions")
    expect(d.description).not.toContain("alert")
  })

  test("a pasted ?mode=apply URL is normalised to the posting page", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["detail", `${JOB_URL}?mode=apply&apply=yes&in_iframe=1&hashed=-123`],
      await routes(),
      HOSTS,
    )
    parseJSON(result)
    expect(requests[0].pathname).toBe(JOB_PATH)
    expect(requests[0].searchParams.get("in_iframe")).toBe("1")
    expect(requests[0].searchParams.get("mode")).toBeNull()
    expect(requests[0].searchParams.get("apply")).toBeNull()
  })

  test("plain format by ID with --portal", async () => {
    const { result } = await runCLIWithFixtures(["detail", "11021", "-p", "careers-usu", "--format", "plain"], await routes(), HOSTS)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("careers-usu · Brigham City, UT, US")
    expect(result.stdout).toContain("Posted: 2026-11-25")
    expect(result.stdout).toContain("Requisition ID: 2026-11021")
    expect(result.stdout).toContain("URL: https://careers-usu.icims.com/jobs/11021/job")
  })

  test("a closed posting exits 1 with NOT_FOUND", async () => {
    const missing = await runCLIWithFixtures(["detail", "999999", "-p", "careers-usu"], await routes(), HOSTS)
    expect(missing.result.exitCode).toBe(1)
    expect(JSON.parse(missing.result.stderr).code).toBe("NOT_FOUND")
  })

  test("a portal error page instead of the posting exits 1 with NOT_FOUND", async () => {
    const errorPage = { "careers-usu.icims.com/jobs/11021/job": { body: "<html><body>Site Not Found</body></html>" } }
    const wrong = await runCLIWithFixtures(["detail", "11021", "-p", "careers-usu"], errorPage, HOSTS)
    expect(wrong.result.exitCode).toBe(1)
    expect(JSON.parse(wrong.result.stderr).code).toBe("NOT_FOUND")
  })

  test("an unknown detail portal exits 1 with NOT_FOUND", async () => {
    const { result } = await runCLIWithFixtures(
      ["detail", "11021", "-p", "careers-nope"],
      {},
      [...HOSTS, "careers-nope.icims.com"],
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
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
  test("no command prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("USAGE")
  })
  test("missing --portal", () => expectError(["search", "-q", "nurse"], "NO_PORTAL"))
  test("bogus flag", () => expectError(["search", "-p", "careers-usu", "--bogus", "x"], "UNKNOWN_FLAG"))
  test("stray positional argument", () => expectError(["search", "-p", "careers-usu", "-q", "nurse", "aide"], "BAD_ARG"))
  test("bad portal", () => expectError(["search", "-p", "https://example.com/jobs"], "BAD_ARG"))
  test("bare ID without --portal", () => expectError(["detail", "11021"], "BAD_ID"))
  test("a URL together with --portal is rejected, not silently ignored", () =>
    expectError(["detail", "https://careers-usu.icims.com/jobs/11021/job", "-p", "careers-usu"], "BAD_ARG"))
  test("non-iCIMS detail URL", () => expectError(["detail", "https://www.linkedin.com/jobs/view/1234567890"], "BAD_ID"))
  test("fractional --jobage", () => expectError(["search", "-p", "careers-usu", "--jobage", "0.5"], "BAD_ARG"))
  test("--page 0", () => expectError(["search", "-p", "careers-usu", "--page", "0"], "BAD_ARG"))
  test("bad --format", () => expectError(["search", "-p", "careers-usu", "--format", "xml"], "BAD_ARG"))
  test("bad --remote value", () => expectError(["search", "-p", "careers-usu", "--remote", "office"], "BAD_ARG"))
  test("bare --remote", () => expectError(["search", "-p", "careers-usu", "--remote"], "BAD_ARG"))
  test("detail --format table is not supported", () =>
    expectError(["detail", "https://careers-usu.icims.com/jobs/1/x/job", "--format", "table"], "BAD_ARG"))
  test("--__proto__ is an unknown flag, not dropped", () =>
    expectError(["search", "-p", "careers-usu", "--__proto__", "x"], "UNKNOWN_FLAG"))
  test("--_ cannot overwrite the positional slot", () =>
    expectError(["search", "-p", "careers-usu", "--_", "x"], "UNKNOWN_FLAG"))
  test("repeated flag, including via its alias", () => expectError(["search", "-p", "careers-usu", "--portal", "other"], "BAD_ARG"))
  test("inherited object key is not a command", () => expectError(["toString", "--foo"], "BAD_CMD"))
})
