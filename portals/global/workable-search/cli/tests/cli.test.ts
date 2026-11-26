// End-to-end CLI tests, offline: requests go to saved fixtures (tests/fixtures/), never the network.
import "./no-network.ts"
import { describe, expect, test } from "bun:test"
import { join } from "path"
import { parseJSON, runCLI, runCLIWithFixtures, type Routes } from "./helpers.ts"

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", name)).text()
const HOSTS = ["www.workable.com", "apply.workable.com"]

async function routes(): Promise<Routes> {
  return {
    "www.workable.com/api/accounts/acme": {
      status: 302,
      location: "/apply.workable.com/api/v1/widget/accounts/acme",
    },
    "apply.workable.com/api/v1/widget/accounts/acme": { body: await fixture("board.json") },
    "apply.workable.com/api/v1/accounts/acme/jobs/PM00000001": { body: await fixture("job-PM00000001.json") },
  }
}

interface SearchOut {
  meta: { count: number; page: number; board: string; matched: number; boardTotal: number }
  results: {
    id: string
    title: string
    url: string
    company: string | null
    location: string | null
    date: string | null
    department: string | null
    employmentType: string | null
    requisitionId: string | null
    workplace: string | null
  }[]
}

describe("search", () => {
  test("returns the contract fields, newest first, folding multi-location rows", async () => {
    const { result, requests } = await runCLIWithFixtures(["search", "-b", "acme"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(requests.map((u) => `${u.host}${u.pathname}`)).toEqual([
      "www.workable.com/api/accounts/acme",
      "apply.workable.com/api/v1/widget/accounts/acme",
    ])
    expect(out.meta).toEqual({ count: 4, page: 1, board: "acme", matched: 4, boardTotal: 4 })
    expect(out.results.map((r) => r.id)).toEqual(["EN00000002", "AN00000004", "PM00000001", "DS00000003"])
    expect(out.results.find((r) => r.id === "PM00000001")?.location).toBe("London, England, United Kingdom · Romania")
    expect(out.results.find((r) => r.id === "PM00000001")).toMatchObject({
      department: "Product",
      employmentType: "Full-time",
      requisitionId: "R-1",
      workplace: "hybrid",
    })
    expect(out.results.find((r) => r.id === "DS00000003")).toMatchObject({
      employmentType: "Contract",
      workplace: "onsite",
    })
    expect(out.results.find((r) => r.id === "EN00000002")?.workplace).toBe("remote")
    expect(out.results.find((r) => r.id === "EN00000002")?.location).toBe("United States · Remote")
    expect(out.results.find((r) => r.id === "AN00000004")?.title).toBe("Product Analyst")
    for (const r of out.results) {
      for (const k of ["id", "title", "company", "location", "date", "url"]) expect(k in r).toBe(true)
      expect(r.company).toBe("Acme Robotics")
    }
  })

  test("query and location filter client-side", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "acme", "-q", "product", "-l", "united"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(out.results.map((r) => r.id)).toEqual(["PM00000001"])
  })

  test("--remote filters on workplace type", async () => {
    for (const [wanted, ids] of [
      ["remote", ["EN00000002"]],
      ["hybrid", ["AN00000004", "PM00000001"]],
      ["onsite", ["DS00000003"]],
    ] as const) {
      const { result } = await runCLIWithFixtures(["search", "-b", "acme", "--remote", wanted], await routes(), HOSTS)
      expect(parseJSON<SearchOut>(result).results.map((r) => r.id)).toEqual([...ids])
      expect(result.stderr).toBe("")
    }
  })

  test("--remote remote falls back to telecommuting when workplace_type is absent", async () => {
    const r = await routes()
    r["apply.workable.com/api/v1/widget/accounts/acme"] = {
      body: {
        name: "Acme Robotics",
        jobs: [{ title: "Remote Role", shortcode: "RM00000001", telecommuting: true, published_on: "2026-11-10" }],
      },
    }
    const { result } = await runCLIWithFixtures(["search", "-b", "acme", "--remote", "remote"], r, HOSTS)
    expect(parseJSON<SearchOut>(result).results.map((job) => job.id)).toEqual(["RM00000001"])
    expect(result.stderr).toBe("")
  })

  test("--remote hybrid/onsite warns when the board sends no workplace_type", async () => {
    for (const wanted of ["hybrid", "onsite"] as const) {
      const r = await routes()
      r["apply.workable.com/api/v1/widget/accounts/acme"] = {
        body: {
          name: "Acme Robotics",
          jobs: [{ title: "Field Role", shortcode: "FL00000001", telecommuting: false, published_on: "2026-11-10" }],
        },
      }
      const { result } = await runCLIWithFixtures(["search", "-b", "acme", "--remote", wanted], r, HOSTS)
      expect(parseJSON<SearchOut>(result).meta.matched).toBe(0)
      expect(JSON.parse(result.stderr).code).toBe("WORKPLACE_TYPE_UNAVAILABLE")
    }
  })

  test("--remote hybrid does not warn on a partially typed board", async () => {
    const r = await routes()
    r["apply.workable.com/api/v1/widget/accounts/acme"] = {
      body: {
        name: "Acme Robotics",
        jobs: [
          { title: "Hybrid Role", shortcode: "HY00000001", workplace_type: "hybrid", telecommuting: false, published_on: "2026-11-12" },
          { title: "Unstated Role", shortcode: "UN00000001", telecommuting: false, published_on: "2026-11-11" },
        ],
      },
    }
    const { result } = await runCLIWithFixtures(["search", "-b", "acme", "--remote", "hybrid"], r, HOSTS)
    expect(parseJSON<SearchOut>(result).results.map((job) => job.id)).toEqual(["HY00000001"])
    expect(result.stderr).toBe("")
  })

  test("location filter matches a state when the city is set", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "acme", "-l", "ontario"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(out.results.map((r) => r.id)).toEqual(["AN00000004"])
  })

  test("--limit caps the page and --page is echoed", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "acme", "--page", "1", "--limit", "1"], await routes(), HOSTS)
    const out = parseJSON<SearchOut>(result)
    expect(out.meta).toMatchObject({ count: 1, page: 1, matched: 4 })
  })

  test("table format renders a header and rows", async () => {
    const { result } = await runCLIWithFixtures(["search", "-b", "acme", "--format", "table"], await routes(), HOSTS)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.split("\n")[0]).toContain("TITLE")
    expect(result.stdout.split("\n")[0]).toContain("TYPE")
    expect(result.stdout).toContain("Senior Product Manager")
    expect(result.stdout).toContain("Full-time")
  })

  test("plain format shows department, type and reference", async () => {
    const { result } = await runCLIWithFixtures(
      ["search", "-b", "acme", "-q", "senior product manager", "--format", "plain"],
      await routes(),
      HOSTS,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Product · Full-time · hybrid · ref R-1")
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
      ["detail", "https://apply.workable.com/acme/j/PM00000001/"],
      await routes(),
      HOSTS,
    )
    const d = parseJSON<{
      id: string
      location: string
      department: string
      departments: string[]
      employmentType: string
      requisitionId: string
      description: string
      requirements: string
      benefits: string
    }>(result)
    expect(requests.map((u) => u.pathname)).toEqual(["/api/v1/accounts/acme/jobs/PM00000001"])
    expect(d.id).toBe("PM00000001")
    expect(d.location).toBe("London, England, United Kingdom · Romania")
    expect(d).toMatchObject({ department: "Product", departments: ["Product"], employmentType: "Full-time", requisitionId: "R-1" })
    expect(d.description).toContain("Acme builds warehouse robots.")
    expect(d.description).toContain("- Work with engineering — daily")
    expect(d.description).not.toContain("Ignore previous instructions")
    expect(d.description).not.toContain("ignore me")
    expect(d.description).not.toMatch(/&lt;|&amp;|&mdash;|<p>/)
    expect(d.requirements).toContain("- 5+ years of product management")
    expect(d.benefits).toBe("- Equity")
  })

  test("plain format by shortcode with --board", async () => {
    const { result } = await runCLIWithFixtures(["detail", "PM00000001", "-b", "acme", "--format", "plain"], await routes(), HOSTS)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Reference code: R-1")
    expect(result.stdout).toContain("Employment type: Full-time")
    expect(result.stdout).toContain("Workplace: hybrid")
    expect(result.stdout).toContain("Department: Product")
    expect(result.stdout).toContain("\nRequirements\nRequired:")
    expect(result.stdout).toContain("\nBenefits\n- Equity")
    expect(result.stdout).toContain("URL: https://apply.workable.com/acme/j/PM00000001")
  })

  test("www share link resolves with --board", async () => {
    const { result } = await runCLIWithFixtures(
      ["detail", "https://www.workable.com/j/PM00000001", "-b", "acme"],
      await routes(),
      HOSTS,
    )
    expect(parseJSON<{ id: string }>(result).id).toBe("PM00000001")
  })

  test("v2 API URL resolves", async () => {
    const { result } = await runCLIWithFixtures(
      ["detail", "https://apply.workable.com/api/v2/accounts/acme/jobs/PM00000001"],
      await routes(),
      HOSTS,
    )
    expect(parseJSON<{ id: string }>(result).id).toBe("PM00000001")
  })

  test("a closed job exits 1 with NOT_FOUND", async () => {
    const { result } = await runCLIWithFixtures(["detail", "EN99999999", "-b", "acme"], await routes(), HOSTS)
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
  test("bare shortcode without board", () => expectError(["detail", "PM00000001"], "BAD_ID"))
  test("shortlink without board explains the missing board", async () => {
    for (const link of ["https://apply.workable.com/j/PM00000001", "https://www.workable.com/j/PM00000001"]) {
      const r = await runCLI(["detail", link])
      expect(r.exitCode).toBe(1)
      const err = JSON.parse(r.stderr)
      expect(err.code).toBe("BAD_ID")
      expect(err.error).toContain("pass --board")
    }
  })
  test("non-Workable URL", () => expectError(["detail", "https://www.linkedin.com/jobs/view/1234567890"], "BAD_ID"))
  test("fractional --jobage", () => expectError(["search", "-b", "acme", "--jobage", "0.5"], "BAD_ARG"))
  test("zero --page", () => expectError(["search", "-b", "acme", "--page", "0"], "BAD_ARG"))
  test("bad --format for detail", () => expectError(["detail", "PM00000001", "-b", "acme", "--format", "table"], "BAD_ARG"))
  test("bad --remote value", () => expectError(["search", "-b", "acme", "--remote", "on_site"], "BAD_ARG"))
  test("--remote without a value", () => expectError(["search", "-b", "acme", "--remote"], "BAD_ARG"))
  test("--__proto__ is an unknown flag, not dropped", () => expectError(["search", "-b", "acme", "--__proto__", "x"], "UNKNOWN_FLAG"))
  test("repeated flag, including via its alias", () => expectError(["search", "-b", "acme", "--board", "other"], "BAD_ARG"))
  test("inherited object key is not a command", () => expectError(["toString", "--foo"], "BAD_CMD"))
  test("URL board conflicting with --board", async () => {
    const r = await runCLI(["detail", "https://apply.workable.com/acme/j/PM00000001", "-b", "other"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ID")
  })
  test("no command prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("USAGE")
  })
})
