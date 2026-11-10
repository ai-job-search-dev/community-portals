import { afterEach, describe, expect, test } from "bun:test"
import { runDetail } from "../src/commands/detail.ts"
import { MAX_PAGES, runSearch, type SearchOpts } from "../src/commands/search.ts"

// Offline: the output contract of `search` and `detail` against a mocked site.

const originalFetch = globalThis.fetch
const originalStdout = process.stdout.write
const originalStderr = process.stderr.write

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalStdout
  process.stderr.write = originalStderr
})

function capture(stream: "stdout" | "stderr"): () => string {
  let buf = ""
  process[stream].write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString()
    return true
  }) as typeof process.stdout.write
  return () => buf
}

const page = (pageProps: unknown) =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } }).replace(/</g, "\\u003c")}</script></body></html>`

const job = (n: number, over: Record<string, unknown> = {}) => ({
  id: `${1000 + n}-role-${n}`,
  position: `Role ${n}`,
  company: { name: "Acme" },
  city: "Gdańsk",
  remote: false,
  experienceLevel: "senior",
  contractB2b: true,
  showSalary: true,
  denominatedSalaryLong: { money: "20 000 - 25 000", currency: "PLN", hidden: false },
  technologyTags: ["PHP", "Symfony"],
  ...over,
})

const listPage = (jobs: unknown[], totalCount = jobs.length) => page({ totalCount, jobs })
const fullPage = (start: number) => listPage(Array.from({ length: 50 }, (_, i) => job(start + i)), 9999)

const detailPage = (id: string, publishedAt: string | null) =>
  page({
    __APOLLO_STATE__: {
      [`Job:${id}`]: {
        id,
        position: "PHP Developer",
        company: { __ref: "Company:1-acme" },
        details: "<p>Build <b>things</b></p>",
        requirements: "<p>PHP 8</p>",
        state: "published",
        publishedAt,
        endsAt: "2999-01-01T00:00:00+01:00",
        workModes: ["full-remote"],
        locations: [{ location: { cityEn: "Warsaw" } }],
        b2bSalary: { money: "20 000", currency: "PLN", hidden: false },
        technologyTags: ["Symfony"],
        contractB2b: true,
      },
      "Company:1-acme": { name: "Acme" },
    },
  })

/** Route by URL: `routes` maps a predicate to a body (or [status, body]). Records every URL requested. */
function mockSite(handler: (url: URL) => string | [number, string]): string[] {
  const seen: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    seen.push(String(input))
    const r = handler(new URL(String(input)))
    const [status, body] = typeof r === "string" ? [200, r] : r
    return new Response(body, { status })
  }) as unknown as typeof fetch
  return seen
}

const base: SearchOpts = { query: "PHP", page: 1, pageDelayMs: 0, format: "json" }

describe("search output", () => {
  test("json carries the meta block and every contract field", async () => {
    mockSite(() => listPage([job(1), job(2)], 2))
    const out = capture("stdout")
    expect(await runSearch(base)).toBe(0)
    const parsed = JSON.parse(out())
    expect(parsed.meta).toEqual({ count: 2, total: 2, page: 1, pages: 1, truncated: false })
    const r = parsed.results[0]
    for (const key of ["id", "title", "company", "location", "date", "url", "salary", "tags", "level", "contracts"]) {
      expect(r).toHaveProperty(key)
    }
    expect(r.url).toStartWith("https://bulldogjob.pl/companies/jobs/")
  })

  test("results are sorted newest first by offer id", async () => {
    mockSite(() => listPage([job(1), job(3), job(2)]))
    const out = capture("stdout")
    await runSearch(base)
    expect(JSON.parse(out()).results.map((r: { title: string }) => r.title)).toEqual(["Role 3", "Role 2", "Role 1"])
  })

  test("table prints a header and one row per offer", async () => {
    mockSite(() => listPage([job(1)]))
    const out = capture("stdout")
    expect(await runSearch({ ...base, format: "table" })).toBe(0)
    const lines = out().trimEnd().split("\n")
    expect(lines[0]).toContain("TITLE")
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain("Role 1")
  })

  test("table says so when nothing matches", async () => {
    mockSite(() => listPage([]))
    const out = capture("stdout")
    expect(await runSearch({ ...base, format: "table" })).toBe(0)
    expect(out().trim()).toBe("No results.")
  })

  test("plain prints title, id and url per offer", async () => {
    mockSite(() => listPage([job(1)]))
    const out = capture("stdout")
    expect(await runSearch({ ...base, format: "plain" })).toBe(0)
    expect(out()).toContain("Role 1")
    expect(out()).toContain("id: 1001-role-1")
    expect(out()).toContain("https://bulldogjob.pl/companies/jobs/1001-role-1")
  })

  test("--limit caps the emitted results", async () => {
    mockSite(() => listPage([job(1), job(2), job(3)]))
    const out = capture("stdout")
    await runSearch({ ...base, limit: 2 })
    expect(JSON.parse(out()).results).toHaveLength(2)
  })

  test("filters become path segments of the list URL", async () => {
    const urls = mockSite(() => listPage([]))
    capture("stdout")
    await runSearch({ page: 1, query: "PHP", level: "senior", city: "Warszawa", format: "json" })
    expect(urls).toEqual(["https://bulldogjob.pl/companies/jobs/s/skills,PHP/experienceLevel,senior/city,Warszawa"])
  })

  test("only contacts bulldogjob.pl", async () => {
    const urls = mockSite(() => listPage([job(1)]))
    capture("stdout")
    capture("stderr") // the list page stands in for the detail page, so the date lookup warns
    await runSearch({ ...base, dates: true })
    for (const u of urls) expect(new URL(u).hostname).toBe("bulldogjob.pl")
  })

  test("extra query words filter client-side by title or tag and sweep all pages", async () => {
    const urls = mockSite((u) =>
      u.pathname.includes("page,2")
        ? listPage([job(60, { position: "PHP Architect" })])
        : listPage(Array.from({ length: 50 }, (_, i) => job(i + 1)), 51),
    )
    const out = capture("stdout")
    expect(await runSearch({ ...base, query: "PHP architect" })).toBe(0)
    const parsed = JSON.parse(out())
    expect(parsed.results.map((r: { title: string }) => r.title)).toEqual(["PHP Architect"])
    expect(parsed.meta.pages).toBe(2)
    expect(urls).toHaveLength(2)
  })

  test("--all sweeps until a short page", async () => {
    const urls = mockSite((u) => (u.pathname.includes("page,2") ? listPage([job(99)]) : fullPage(1)))
    const out = capture("stdout")
    await runSearch({ ...base, all: true })
    const parsed = JSON.parse(out())
    expect(parsed.meta.pages).toBe(2)
    expect(parsed.meta.count).toBe(51)
    expect(urls).toHaveLength(2)
  })

  test("--all stops at the page cap and warns PAGE_CAP_REACHED", async () => {
    const urls = mockSite((u) => fullPage(Number(u.pathname.match(/page,(\d+)/)?.[1] ?? 1) * 100))
    const out = capture("stdout")
    const err = capture("stderr")
    await runSearch({ ...base, all: true })
    expect(urls).toHaveLength(MAX_PAGES)
    expect(JSON.parse(out()).meta.truncated).toBe(true)
    expect(JSON.parse(err().trim().split("\n")[0]).code).toBe("PAGE_CAP_REACHED")
  })

  test("--all keeps sweeping past a page with one malformed entry", async () => {
    const urls = mockSite((u) => {
      const p = Number(u.pathname.match(/page,(\d+)/)?.[1] ?? 1)
      if (p === 1) return page({ totalCount: 60, jobs: [...Array.from({ length: 49 }, (_, i) => job(i + 1)), null] })
      return listPage([job(99)], 60)
    })
    const out = capture("stdout")
    await runSearch({ ...base, all: true })
    expect(urls).toHaveLength(2)
    expect(JSON.parse(out()).meta.count).toBe(50)
  })

  test("a sweep of exactly the cap with nothing after it does not warn", async () => {
    const total = MAX_PAGES * 50
    mockSite((u) => {
      const p = Number(u.pathname.match(/page,(\d+)/)?.[1] ?? 1)
      return listPage(Array.from({ length: 50 }, (_, i) => job(p * 100 + i)), total)
    })
    const out = capture("stdout")
    const err = capture("stderr")
    await runSearch({ ...base, all: true })
    expect(JSON.parse(out()).meta.truncated).toBe(false)
    expect(err()).not.toContain("PAGE_CAP_REACHED")
  })

  test("--jobage reads dates from detail pages and drops older offers", async () => {
    const recent = new Date(Date.now() - 86400000).toISOString()
    const old = "2020-01-01T10:00:00+01:00"
    const urls = mockSite((u) => {
      if (u.pathname.endsWith("1001-role-1")) return detailPage("1001-role-1", recent)
      if (u.pathname.endsWith("1002-role-2")) return detailPage("1002-role-2", old)
      return listPage([job(1), job(2)])
    })
    const out = capture("stdout")
    expect(await runSearch({ ...base, jobage: 7 })).toBe(0)
    const parsed = JSON.parse(out())
    expect(parsed.results.map((r: { id: string }) => r.id)).toEqual(["1001-role-1"])
    expect(parsed.results[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(urls).toHaveLength(3)
  })

  test("--jobage keeps an offer whose date lookup fails and warns DATE_LOOKUP_FAILED", async () => {
    mockSite((u) => (u.pathname.endsWith("1001-role-1") ? [404, ""] : listPage([job(1)])))
    const out = capture("stdout")
    const err = capture("stderr")
    expect(await runSearch({ ...base, jobage: 7 })).toBe(0)
    expect(JSON.parse(out()).results).toHaveLength(1)
    expect(JSON.parse(err().trim()).code).toBe("DATE_LOOKUP_FAILED")
  })

  test("a missing list page exits 1 with NOT_FOUND", async () => {
    mockSite(() => [404, ""])
    const err = capture("stderr")
    expect(await runSearch(base)).toBe(1)
    expect(JSON.parse(err()).code).toBe("NOT_FOUND")
  })

  test("changed markup exits 1 with PARSE_FAILED", async () => {
    mockSite(() => "<html>maintenance</html>")
    const err = capture("stderr")
    expect(await runSearch(base)).toBe(1)
    expect(JSON.parse(err()).code).toBe("PARSE_FAILED")
  })
})

describe("detail output", () => {
  test("json returns the parsed offer fetched by id", async () => {
    const urls = mockSite(() => detailPage("260906", "2026-11-02T10:00:00+01:00"))
    const out = capture("stdout")
    expect(await runDetail({ id: "260906", format: "json" })).toBe(0)
    expect(urls).toEqual(["https://bulldogjob.pl/companies/jobs/260906"])
    const d = JSON.parse(out())
    expect(d.company).toBe("Acme")
    expect(d.date).toBe("2026-11-02")
    expect(d.isActive).toBe(true)
    expect(d.description).toContain("Build things")
    expect(d.description).not.toMatch(/<[a-z][^>]*>/i)
  })

  test("plain prints status, salary and url", async () => {
    mockSite(() => detailPage("260906", "2026-11-02T10:00:00+01:00"))
    const out = capture("stdout")
    expect(await runDetail({ id: "260906", format: "plain" })).toBe(0)
    expect(out()).toContain("Status: ACTIVE")
    expect(out()).toContain("Salary: 20 000 PLN (B2B)")
    expect(out()).toContain("URL: https://bulldogjob.pl/companies/jobs/260906")
  })

  test("plain output separates header, facts and description with blank lines", async () => {
    mockSite(() => detailPage("260906", "2026-11-02T10:00:00+01:00"))
    const out = capture("stdout")
    await runDetail({ id: "260906", format: "plain" })
    const blocks = out().trimEnd().split("\n\n")
    // header | facts | description (itself two paragraphs) | URL
    expect(blocks[0]).toContain("PHP Developer")
    expect(blocks[1]).toContain("Status: ACTIVE")
    expect(blocks[2]).toContain("Build")
    expect(blocks[blocks.length - 1]).toMatch(/^URL: /)
  })

  test("a full offer URL is fetched from its own path", async () => {
    const urls = mockSite(() => detailPage("260906-php-dev", "2026-11-02T10:00:00+01:00"))
    capture("stdout")
    await runDetail({ id: "https://bulldogjob.pl/companies/jobs/260906-php-dev", format: "json" })
    expect(urls).toEqual(["https://bulldogjob.pl/companies/jobs/260906-php-dev"])
  })

  test("a 404 exits 1 with NOT_FOUND", async () => {
    mockSite(() => [404, ""])
    const err = capture("stderr")
    expect(await runDetail({ id: "260906", format: "json" })).toBe(1)
    expect(JSON.parse(err()).code).toBe("NOT_FOUND")
  })

  test("an id on another host exits 1 with BAD_ID and makes no request", async () => {
    const urls = mockSite(() => "")
    const err = capture("stderr")
    expect(await runDetail({ id: "https://bulldogjob.pl.evil.io/companies/jobs/260906", format: "json" })).toBe(1)
    expect(JSON.parse(err()).code).toBe("BAD_ID")
    expect(urls).toHaveLength(0)
  })
})
