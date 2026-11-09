// Live smoke tests against justjoin.it. They make a handful of real requests;
// if the portal is unreachable or rate-limits, they fail loudly rather than
// pretending the parser still works.
import { describe, expect, test } from "bun:test"
import { runCLI, parseJSON } from "./helpers.js"
import type { JobCard } from "../src/helpers.js"

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
      expect(job.url).toStartWith("https://justjoin.it/job-offer/")
      // A parser that half-works is worse than one that fails: catch HTML
      // fragments and undecoded entities leaking into the fields.
      expect(job.title).not.toContain("<")
      expect(job.title).not.toContain("&amp;")
    }
  })

  test("populates company and city on at least most results", async () => {
    const r = await runCLI(["search", "-q", "developer", "--limit", "10", "--format", "json"])
    const body = parseJSON<SearchResponse>(r)
    const named = body.results.filter((j) => j.company && j.location)
    expect(named.length).toBeGreaterThan(body.results.length / 2)
  })

  test("--workplace remote only returns remote offers", async () => {
    const r = await runCLI(["search", "-q", "php", "--workplace", "remote", "--limit", "8", "--format", "json"])
    const body = parseJSON<SearchResponse>(r)
    expect(body.results.length).toBeGreaterThan(0)
    for (const job of body.results) expect(job.workplaceType).toBe("remote")
  })

  test("--jobage keeps only recent postings", async () => {
    const r = await runCLI(["search", "-q", "php", "--jobage", "14", "--limit", "10", "--format", "json"])
    const body = parseJSON<SearchResponse>(r)
    const cutoff = Date.now() - 15 * 86400000
    for (const job of body.results) {
      if (!job.date) continue
      expect(new Date(`${job.date}T00:00:00Z`).getTime()).toBeGreaterThan(cutoff)
    }
  })
})

describe("live detail", () => {
  test("returns a readable description for a real offer", async () => {
    const search = await runCLI(["search", "-q", "php", "--limit", "1", "--format", "json"])
    const first = parseJSON<SearchResponse>(search).results[0]!
    const r = await runCLI(["detail", first.id, "--format", "json"])
    const job = parseJSON<JobCard & { description: string | null }>(r)
    expect(job.id).toBe(first.id)
    expect(job.title).toBeTruthy()
    expect(job.description).toBeTruthy()
    expect(job.description!.length).toBeGreaterThan(80)
    expect(job.description).not.toContain("<p>")
    expect(job.description).not.toContain("&amp;")
  })

  test("a missing offer exits 1 with NOT_FOUND", async () => {
    const r = await runCLI(["detail", "definitely-not-a-real-offer-slug-php"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("NOT_FOUND")
  })
})
