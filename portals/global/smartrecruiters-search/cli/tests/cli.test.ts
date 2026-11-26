// End-to-end CLI tests, offline: requests go to saved fixtures (tests/fixtures/), never the network.
import "./no-network.ts"
import { describe, expect, test } from "bun:test"
import { join } from "path"
import { parseJSON, runCLI, runCLIWithFixtures, type Routes } from "./helpers.ts"

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", name)).text()
const HOSTS = ["api.smartrecruiters.com"]
const DAY = 86_400_000

/** Dates relative to the test run, so a valid --jobage test does not depend on the calendar. */
function datedBoard() {
  const now = Date.now()
  return {
    offset: 0,
    limit: 20,
    totalFound: 2,
    content: [
      {
        id: "111111111111111",
        name: "Recent Role",
        releasedDate: new Date(now - DAY).toISOString(),
        visibility: "PUBLIC",
        company: { name: "Acme" },
        location: { fullLocation: "Berlin, Germany" },
        typeOfEmployment: { label: "Full-time" },
      },
      {
        id: "222222222222222",
        name: "Old Role",
        releasedDate: new Date(now - 30 * DAY).toISOString(),
        visibility: "PUBLIC",
        company: { name: "Acme" },
        location: { fullLocation: "Berlin, Germany" },
        typeOfEmployment: { label: "Full-time" },
      },
    ],
  }
}

function badRows() {
  return {
    offset: 0,
    limit: 20,
    totalFound: 3,
    content: [
      null,
      { id: "foo/bar", name: "Bad Id" },
      {
        id: "333333333333333",
        name: "Good Row",
        releasedDate: new Date().toISOString(),
        visibility: "PUBLIC",
        company: { name: "Acme" },
      },
    ],
  }
}

async function routes(): Promise<Routes> {
  return {
    "api.smartrecruiters.com/v1/companies/BoschGroup/postings": { body: await fixture("board.json") },
    "api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000163798847": {
      body: await fixture("job-744000163798847.json"),
    },
    "api.smartrecruiters.com/v1/companies/BoschGroup/postings/4f049d2a-9f39-467e-ae4f-ba8a6107db58": {
      body: await fixture("job-744000163798847.json"),
    },
    "api.smartrecruiters.com/v1/companies/BoschGroup/postings/555555555555555": {
      body: {
        id: "555555555555555",
        name: "Internal Role",
        visibility: "INTERNAL",
        active: true,
        company: { name: "Bosch Group" },
      },
    },
    "api.smartrecruiters.com/v1/companies/BoschGroup/postings/666666666666666": { body: {} },
    "api.smartrecruiters.com/v1/companies/BoschGroup/postings/777777777777777": {
      body: { id: "888888888888888", name: "Other Role" },
    },
    "api.smartrecruiters.com/v1/companies/BoschGroup/postings/333333333333333": {
      body: {
        id: "333333333333333",
        name: "Closed Role",
        visibility: "PUBLIC",
        active: false,
        company: { name: "Acme" },
        jobAd: { sections: { jobDescription: { text: "<p>Closed ad</p>" } } },
      },
    },
    "api.smartrecruiters.com/v1/companies/no-such-board/postings": {
      body: { offset: 0, limit: 20, totalFound: 0, content: [] },
    },
    "api.smartrecruiters.com/v1/companies/empty-board/postings": {
      body: { offset: 0, limit: 20, totalFound: 0, content: [] },
    },
    "api.smartrecruiters.com/v1/companies/empty-board/departments": {
      body: { totalFound: 0, content: [] },
    },
    "api.smartrecruiters.com/v1/companies/non-public-board/postings": {
      body: {
        offset: 0,
        limit: 20,
        totalFound: 2,
        content: [
          {
            id: "999999999999991",
            name: "Public Role",
            releasedDate: new Date().toISOString(),
            visibility: "PUBLIC",
            company: { name: "Acme" },
          },
          {
            id: "999999999999992",
            name: "Internal Role",
            releasedDate: new Date().toISOString(),
            visibility: "INTERNAL",
            company: { name: "Acme" },
          },
        ],
      },
    },
    "api.smartrecruiters.com/v1/companies/fallback-board/postings": {
      body: (url: URL) =>
        url.searchParams.has("city")
          ? { offset: 0, limit: 20, totalFound: 0, content: [] }
          : {
              offset: 0,
              limit: 20,
              totalFound: 1,
              content: [
                {
                  id: "444444444444444",
                  name: "Penang Role",
                  releasedDate: new Date().toISOString(),
                  visibility: "PUBLIC",
                  company: { name: "Acme" },
                  location: { fullLocation: "Batu Kawan, Penang, Malaysia" },
                },
              ],
            },
    },
    "api.smartrecruiters.com/v1/companies/city-filtered-board/postings": {
      body: (url: URL) => {
        const city = url.searchParams.get("city")
        if (city && url.searchParams.has("locationType")) {
          return { offset: 0, limit: 20, totalFound: 0, content: [] }
        }
        return {
          offset: 0,
          limit: 20,
          totalFound: 1,
          content: [
            {
              id: "555555555555551",
              name: "Berlin Role",
              releasedDate: new Date().toISOString(),
              visibility: "PUBLIC",
              company: { name: "Acme" },
              location: { fullLocation: "Berlin, Germany" },
            },
          ],
        }
      },
    },
    "api.smartrecruiters.com/v1/companies/city-filtered-board/departments": {
      body: { totalFound: 0, content: [] },
    },
    "api.smartrecruiters.com/v1/companies/dated-board/postings": {
      body: (url: URL) => {
        const board = datedBoard()
        const cutoff = url.searchParams.get("releasedAfter")
        if (!cutoff) return board
        const cutoffMs = Date.parse(cutoff)
        const content = board.content.filter((job) => Date.parse(job.releasedDate) >= cutoffMs)
        return { ...board, totalFound: content.length, content }
      },
    },
    "api.smartrecruiters.com/v1/companies/bad-rows/postings": { body: badRows() },
  }
}

interface SearchOut {
  meta: { count: number; page: number; perPage: number; board: string; matched: number; total: number | null }
  results: {
    id: string
    title: string
    url: string
    company: string | null
    location: string | null
    date: string | null
    department: string | null
    function: string | null
    employmentType: string | null
    experienceLevel: string | null
    requisitionId: string | null
    language: string | null
  }[]
}

describe("search", () => {
  test("returns the contract fields", async () => {
    const { result, requests } = await runCLIWithFixtures(["search", "-b", "BoschGroup"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(requests.map((u) => u.pathname)).toEqual(["/v1/companies/BoschGroup/postings"])
    expect(out.meta).toEqual({ count: 3, page: 1, perPage: 20, board: "BoschGroup", matched: 3, total: 3 })
    expect(out.results.map((r) => r.id)).toEqual(["744000163798847", "744000163798848", "744000163798849"])
    expect(out.results[0]).toMatchObject({
      company: "Bosch Group",
      location: "Batu Kawan, Penang, Malaysia",
      department: null,
      function: "Manufacturing",
      employmentType: "Internship",
      experienceLevel: "Internship",
      requisitionId: "REF301888O",
      language: "en",
    })
    expect(out.results[1].location).toBe("Berlin, Germany, Remote")
    expect(out.results[2].employmentType).toBe("Contract")
    for (const r of out.results) {
      for (const k of ["id", "title", "company", "location", "date", "url"]) expect(k in r).toBe(true)
      expect(r.url).toStartWith("https://jobs.smartrecruiters.com/BoschGroup/")
    }
  })

  test("skips a non-public row from a synthetic board response", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "non-public-board"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(out.results.map((r) => r.id)).toEqual(["999999999999991"])
    expect(out.meta).toMatchObject({ count: 1, matched: 1, total: 2 })
  })

  test("query goes to the board's server-side search", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["search", "-b", "BoschGroup", "-q", "software engineer"],
      await routes(),
      HOSTS,
    )
    expect(parseJSON<SearchOut>(result).results).toHaveLength(3)
    expect(requests[0].searchParams.get("q")).toBe("software engineer")
    expect(requests[0].searchParams.get("limit")).toBe("20")
    expect(requests[0].searchParams.get("offset")).toBe("0")
    expect(requests[0].searchParams.get("destination")).toBe("PUBLIC")
  })

  test("a query value may start with a dash", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["search", "-b", "BoschGroup", "-q", "-remote"],
      await routes(),
      HOSTS,
    )
    expect(result.exitCode).toBe(0)
    expect(requests[0].searchParams.get("q")).toBe("-remote")
  })

  test("--remote maps to locationType and supports comma OR", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["search", "-b", "BoschGroup", "--remote", "remote,on-site"],
      await routes(),
      HOSTS,
    )
    expect(result.exitCode).toBe(0)
    expect(requests[0].searchParams.getAll("locationType")).toEqual(["REMOTE", "ONSITE"])
  })

  test("bare --remote means remote", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["search", "-b", "BoschGroup", "--remote"],
      await routes(),
      HOSTS,
    )
    expect(result.exitCode).toBe(0)
    expect(requests[0].searchParams.getAll("locationType")).toEqual(["REMOTE"])
  })

  test("--board accepts a board URL", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["search", "-b", "https://jobs.smartrecruiters.com/BoschGroup"],
      await routes(),
      HOSTS,
    )
    expect(result.exitCode).toBe(0)
    expect(requests[0].pathname).toBe("/v1/companies/BoschGroup/postings")
  })

  test("--city/--country/--region are server-side filters", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["search", "-b", "BoschGroup", "--city", "Berlin", "--country", "de", "--region", "BE"],
      await routes(),
      HOSTS,
    )
    expect(result.exitCode).toBe(0)
    const params = requests[0].searchParams
    expect(params.get("city")).toBe("Berlin")
    expect(params.get("country")).toBe("de")
    expect(params.get("region")).toBe("BE")
    expect(result.stderr).toBe("")
  })

  test("--page maps to an offset and --limit caps the page", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["search", "-b", "BoschGroup", "--page", "3", "--limit", "2"],
      await routes(),
      HOSTS,
    )
    const out = parseJSON<SearchOut>(result)
    expect(requests[0].searchParams.get("offset")).toBe("40")
    expect(out.meta).toMatchObject({ count: 2, page: 3, matched: 3 })
  })

  test("location tries the exact city filter first", async () => {
    const { result, requests } = await runCLIWithFixtures(["search", "-b", "BoschGroup", "-l", "Berlin"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(requests[0].searchParams.get("city")).toBe("Berlin")
    expect(out.results.map((r) => r.id)).toEqual(["744000163798848"])
    expect(result.stderr).toBe("")
  })

  test("location falls back to the fetched page and warns when it is not a city", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "fallback-board", "-l", "penang"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(out.results.map((r) => r.id)).toEqual(["444444444444444"])
    expect(out.meta).toMatchObject({ count: 1, matched: 1, total: 1 })
    const warning = JSON.parse(result.stderr)
    expect(warning.code).toBe("PAGE_SCOPED_FILTER")
    expect(warning.warning).toContain("--location")
  })

  test("a real city emptied by other filters does not fall back or warn", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["search", "-b", "city-filtered-board", "-l", "Berlin", "--remote", "remote"],
      await routes(),
      HOSTS,
    )
    const out = parseJSON<SearchOut>(result)
    expect(out.meta).toMatchObject({ count: 0, matched: 0, total: 0 })
    expect(result.stderr).toBe("")
    const postings = requests.filter((u) => u.pathname.endsWith("/postings"))
    expect(postings).toHaveLength(2)
    expect(postings[0].searchParams.get("locationType")).toBe("REMOTE")
    expect(postings[1].searchParams.has("locationType")).toBe(false)
    expect(postings[1].searchParams.get("city")).toBe("Berlin")
  })

  test("--jobage is sent as releasedAfter and filters the result", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["search", "-b", "dated-board", "--jobage", "7"],
      await routes(),
      HOSTS,
    )
    const out = parseJSON<SearchOut>(result)
    expect(out.results.map((r) => r.title)).toEqual(["Recent Role"])
    expect(out.meta).toMatchObject({ count: 1, matched: 1, total: 1 })
    expect(requests[0].searchParams.get("releasedAfter")).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.stderr).toBe("")
  })

  test("skips a null row and an id that is not a path segment", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "bad-rows"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(result.exitCode).toBe(0)
    expect(out.results.map((r) => r.id)).toEqual(["333333333333333"])
  })

  test("table format renders a header and rows", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "BoschGroup", "--format", "table"], await routes(), HOSTS)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.split("\n")[0]).toContain("TITLE")
    expect(result.stdout.split("\n")[0]).toContain("TYPE")
    expect(result.stdout).toContain("Internship in Human Resources")
    expect(result.stdout).toContain("Internship")
  })

  test("plain format shows unit, type and reference", async () => {
    const { result } = await runCLIWithFixtures(
      ["search", "-b", "BoschGroup", "-l", "batu", "--format", "plain"],
      await routes(),
      HOSTS,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Manufacturing · Internship · ref REF301888O")
  })

  test("an unknown board is detected with the departments probe", async () => {
    const { result, requests } = await runCLIWithFixtures(["search", "-b", "no-such-board"], await routes(), HOSTS)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe("BOARD_NOT_FOUND")
    expect(requests.map((u) => u.pathname)).toEqual([
      "/v1/companies/no-such-board/postings",
      "/v1/companies/no-such-board/departments",
    ])
  })

  test("an existing board with no open roles returns an empty result", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "empty-board"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(result.exitCode).toBe(0)
    expect(out.meta).toMatchObject({ count: 0, matched: 0, total: 0, board: "empty-board" })
    expect(out.results).toEqual([])
  })

  test("an API 404 exits 1 with BOARD_NOT_FOUND", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "missing-board"], await routes(), HOSTS)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe("BOARD_NOT_FOUND")
  })

  test("a response without content[] is an error, not an empty board", async () => {
    const bad = { "api.smartrecruiters.com/v1/companies/BoschGroup/postings": { body: { error: "nope" } } }
    const { result } = await runCLIWithFixtures(["search", "-b", "BoschGroup"], bad, HOSTS)
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("SEARCH_FAILED")
    expect(JSON.parse(result.stderr).error).toContain("content[]")
  })
})

describe("detail", () => {
  test("posting URL returns decoded text without the hidden element", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["detail", "https://jobs.smartrecruiters.com/BoschGroup/744000163798847-internship-in-human-resources?oga=true"],
      await routes(),
      HOSTS,
    )
    const d = parseJSON<{
      id: string
      title: string
      company: string
      location: string
      employmentType: string
      experienceLevel: string
      requisitionId: string
      active: boolean
      description: string
      qualifications: string
      additionalInformation: string
      companyDescription: string
      applyUrl: string
    }>(result)
    expect(requests.map((u) => u.pathname)).toEqual(["/v1/companies/BoschGroup/postings/744000163798847"])
    expect(d).toMatchObject({
      id: "744000163798847",
      company: "Bosch Group",
      location: "Batu Kawan, Penang, Malaysia",
      employmentType: "Internship",
      experienceLevel: "Internship",
      requisitionId: "REF301888O",
      active: true,
    })
    expect(d.description).toContain("Assist with recruitment.")
    expect(d.description).toContain("- Screen resumes")
    expect(d.description).not.toContain("Ignore previous instructions")
    expect(d.description).not.toContain("ignore me")
    expect(d.description).not.toMatch(/&lt;|&amp;|<p>/)
    expect(d.qualifications).toBe("- Currently a full-time student")
    expect(d.additionalInformation).toBe("Apply now to join our team!")
    expect(d.companyDescription).toContain("Bosch builds technology & services.")
    expect(d.applyUrl).toContain("?oga=true")
  })

  test("plain format by posting id with --board prints each section", async () => {
    const { result } = await runCLIWithFixtures(
      ["detail", "744000163798847", "-b", "BoschGroup", "--format", "plain"],
      await routes(),
      HOSTS,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Reference code: REF301888O")
    expect(result.stdout).toContain("Employment type: Internship")
    expect(result.stdout).toContain("Function: Manufacturing")
    expect(result.stdout).toContain("Status: open")
    expect(result.stdout).toContain("\nQualifications\n- Currently a full-time student")
    expect(result.stdout).toContain("\nAdditional information\nApply now to join our team!")
    expect(result.stdout).toContain("\nCompany description\nBosch builds technology & services.")
    expect(result.stdout).toContain("URL: https://jobs.smartrecruiters.com/BoschGroup/744000163798847-internship-in-human-resources")
  })

  test("careers and API URL forms resolve", async () => {
    for (const link of [
      "https://careers.smartrecruiters.com/BoschGroup/744000163798847-internship-in-human-resources",
      "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000163798847",
    ]) {
      const { result } = await runCLIWithFixtures(["detail", link], await routes(), HOSTS)
      expect(parseJSON<{ id: string }>(result).id).toBe("744000163798847")
    }
  })

  test("a UUID posting URL with a title slug requests the actual posting", async () => {
    const { result, requests } = await runCLIWithFixtures(
      ["detail", "https://jobs.smartrecruiters.com/BoschGroup/4f049d2a-9f39-467e-ae4f-ba8a6107db58-internship-in-human-resources"],
      await routes(),
      HOSTS,
    )
    expect(requests[0].pathname).toBe("/v1/companies/BoschGroup/postings/4f049d2a-9f39-467e-ae4f-ba8a6107db58")
    expect(parseJSON<{ id: string }>(result).id).toBe("744000163798847")
  })

  test("an internal posting fetched by id is not found", async () => {
    const { result } = await runCLIWithFixtures(["detail", "555555555555555", "-b", "BoschGroup"], await routes(), HOSTS)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe("NOT_FOUND")
  })

  test("a closed posting still served by the API succeeds with active:false", async () => {
    const { result } = await runCLIWithFixtures(
      ["detail", "333333333333333", "-b", "BoschGroup", "--format", "plain"],
      await routes(),
      HOSTS,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Closed Role")
    expect(result.stdout).toContain("Status: closed")
    expect(result.stdout).toContain("Closed ad")
  })

  test("a malformed detail response is an error, not an untitled success", async () => {
    for (const id of ["666666666666666", "777777777777777"]) {
      const { result } = await runCLIWithFixtures(["detail", id, "-b", "BoschGroup"], await routes(), HOSTS)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe("")
      expect(JSON.parse(result.stderr).code).toBe("DETAIL_FAILED")
    }
  })

  test("a closed job exits 1 with NOT_FOUND", async () => {
    const { result } = await runCLIWithFixtures(["detail", "999999999999999", "-b", "BoschGroup"], await routes(), HOSTS)
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
  test("missing --board", () => expectError(["search", "-q", "engineer"], "NO_BOARD"))
  test("bogus flag", () => expectError(["search", "-b", "BoschGroup", "--bogus", "x"], "UNKNOWN_FLAG"))
  test("stray positional argument", () => expectError(["search", "-b", "BoschGroup", "-q", "software", "engineer"], "BAD_ARG"))
  test("bare posting id without board", () => expectError(["detail", "744000163798847"], "BAD_ID"))
  test("non-SmartRecruiters URL", () => expectError(["detail", "https://www.linkedin.com/jobs/view/1234567890"], "BAD_ID"))
  test("URL board conflicting with --board", async () => {
    const r = await runCLI(["detail", "https://jobs.smartrecruiters.com/BoschGroup/744000163798847", "-b", "other"])
    expect(r.exitCode).toBe(1)
    const err = JSON.parse(r.stderr)
    expect(err.code).toBe("BAD_ID")
    expect(err.error).toContain('board "BoschGroup"')
  })
  test("fractional --jobage", () => expectError(["search", "-b", "BoschGroup", "--jobage", "0.5"], "BAD_ARG"))
  test("--country must be two letters", () => expectError(["search", "-b", "BoschGroup", "--country", "USA"], "BAD_ARG"))
  test("--city requires a value", () => expectError(["search", "-b", "BoschGroup", "--city", ""], "BAD_ARG"))
  test("--remote rejects an unknown mode", () => expectError(["search", "-b", "BoschGroup", "--remote", "anywhere"], "BAD_ARG"))
  test("--remote rejects an empty mode", () => expectError(["search", "-b", "BoschGroup", "--remote", ""], "BAD_ARG"))
  test("unsafe --page is rejected", () => expectError(["search", "-b", "BoschGroup", "--page", "1e308"], "BAD_ARG"))
  test("zero --page", () => expectError(["search", "-b", "BoschGroup", "--page", "0"], "BAD_ARG"))
  test("--_ is an unknown flag, not a positional overwrite", () => expectError(["search", "-b", "BoschGroup", "--_", "x"], "UNKNOWN_FLAG"))
  test("bad --format for detail", () => expectError(["detail", "744000163798847", "-b", "BoschGroup", "--format", "table"], "BAD_ARG"))
  test("--__proto__ is an unknown flag, not dropped", () => expectError(["search", "-b", "BoschGroup", "--__proto__", "x"], "UNKNOWN_FLAG"))
  test("repeated flag, including via its alias", () => expectError(["search", "-b", "BoschGroup", "--board", "other"], "BAD_ARG"))
  test("inherited object key is not a command", () => expectError(["toString", "--foo"], "BAD_CMD"))
  test("no command prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("USAGE")
  })
  test("--help and -h without a command exit 0", async () => {
    for (const flag of ["--help", "-h"]) {
      const r = await runCLI([flag])
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain("USAGE")
    }
  })
})
