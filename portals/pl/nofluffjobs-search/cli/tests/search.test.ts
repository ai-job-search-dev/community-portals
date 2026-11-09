// Live smoke tests against nofluffjobs.com. They make a handful of real
// requests; if the portal is unreachable or its markup changed, they fail
// loudly rather than pretending the parser still works.
import { describe, expect, test } from "bun:test"
import { runCLI, parseJSON } from "./helpers.js"
import type { JobCard, JobDetail } from "../src/helpers.js"

interface SearchResponse {
  meta: { count: number; page: number }
  results: JobCard[]
}

describe("live search", () => {
  test("returns structured results for a real query", async () => {
    const r = await runCLI(["search", "-q", "PHP Symfony", "--limit", "5", "--format", "json"])
    const body = parseJSON<SearchResponse>(r)
    expect(body.meta.page).toBe(1)
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.results.length).toBeLessThanOrEqual(5)
    for (const job of body.results) {
      expect(job.id).toBeTruthy()
      expect(job.title).toBeTruthy()
      expect(job.url).toStartWith("https://nofluffjobs.com/job/")
      // A half-working parser is worse than a failing one: catch HTML fragments
      // and undecoded entities leaking into the fields.
      expect(job.title).not.toContain("<")
      expect(job.title).not.toContain("&amp;")
      expect(job.title).not.toContain("&nbsp;")
    }
  })

  test("company and location are populated on most results", async () => {
    const r = await runCLI(["search", "-q", "developer", "--limit", "10", "--format", "json"])
    const body = parseJSON<SearchResponse>(r)
    const named = body.results.filter((j) => j.company && j.location)
    expect(named.length).toBeGreaterThan(body.results.length / 2)
  })

  test("salaries parse into plausible bands", async () => {
    const r = await runCLI(["search", "-q", "php", "--limit", "10", "--format", "json"])
    const body = parseJSON<SearchResponse>(r)
    const withSalary = body.results.filter((j) => j.salary)
    expect(withSalary.length).toBeGreaterThan(0)
    for (const job of withSalary) {
      expect(job.salary!.from).toBeGreaterThan(0)
      if (job.salary!.to !== null) expect(job.salary!.to).toBeGreaterThanOrEqual(job.salary!.from!)
      // "1.5M" must not have been read as 1 — a monthly band under 100 in any
      // currency means the abbreviation parser regressed.
      if (job.salary!.unit === "month") expect(job.salary!.from).toBeGreaterThan(100)
    }
  })

  test("--limit caps results before any date enrichment", async () => {
    const r = await runCLI(["search", "-q", "php", "--limit", "3", "--dates", "--format", "json"])
    const body = parseJSON<SearchResponse>(r)
    expect(body.results.length).toBeLessThanOrEqual(3)
    expect(body.results.some((j) => j.date !== null)).toBe(true)
  })

  test("--page 2 returns more offers than page 1 (the portal accumulates)", async () => {
    const p1 = parseJSON<SearchResponse>(await runCLI(["search", "-q", "php", "--format", "json"]))
    const p2 = parseJSON<SearchResponse>(await runCLI(["search", "-q", "php", "--page", "2", "--format", "json"]))
    expect(p2.results.length).toBeGreaterThan(p1.results.length)
    // De-duplication is load-bearing here: promoted cards repeat across pages.
    expect(new Set(p2.results.map((j) => j.id)).size).toBe(p2.results.length)
  })
})

describe("live detail", () => {
  test("returns readable sections for a real offer", async () => {
    const search = await runCLI(["search", "-q", "php", "--limit", "1", "--format", "json"])
    const first = parseJSON<SearchResponse>(search).results[0]!
    const r = await runCLI(["detail", first.id, "--format", "json"])
    const job = parseJSON<JobDetail>(r)
    expect(job.id).toBe(first.id)
    expect(job.title).toBeTruthy()
    expect(job.date).toBeTruthy()
    const body = [job.requirements, job.tasks, job.description].filter(Boolean).join("\n")
    expect(body.length).toBeGreaterThan(80)
    expect(body).not.toContain("id=\"posting-")
    expect(body).not.toContain("_ngcontent")
    expect(body).not.toContain("&amp;")
  })

  test("a missing offer exits 1 with NOT_FOUND", async () => {
    const r = await runCLI(["detail", "definitely-not-a-real-offer-slug-nofluff"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("NOT_FOUND")
  })
})
