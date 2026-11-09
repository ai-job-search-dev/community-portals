import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { runDetail } from "../src/commands/detail.js"
import { MAX_ENRICHED, MAX_PAGES, runSearch, type SearchOpts } from "../src/commands/search.js"

// Offline: the output contract of `search` and `detail` against a mocked site.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
const originalStdout = process.stdout.write
const originalStderr = process.stderr.write

beforeEach(() => {
  // The date lookups pause between requests; skip the pause.
  globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as unknown as typeof setTimeout
})

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
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

const card = (slug: string, title: string) =>
  `<a nfj-postings-item="" class="posting-list-item" href="/pl/job/${slug}">
    <h3 data-cy="title position on the job offer listing"> ${title} </h3>
    <nfj-posting-item-salary><span data-cy="salary ranges on the job offer listing"> 900 &ndash; 1&nbsp;100 PLN / day </span></nfj-posting-item-salary>
    <span data-cy="category name on the job offer listing"> Backend </span>
    <h4 class="company-name tw-mb-0"> Acme </h4>
    <nfj-posting-item-city data-cy="location on the job offer listing"> Warszawa </nfj-posting-item-city>
  </a>`

const day = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)

/** A search page. `posted` gives a card its date in the embedded state; omit it for an undated card. */
function listPage(items: { slug: string; posted?: string }[], totalCount = items.length): string {
  const state = {
    abc: {
      totalCount,
      postings: items.filter((i) => i.posted).map((i) => ({ url: i.slug, posted: Date.parse(i.posted!) })),
    },
  }
  return `<html><nfj-postings-list listname="search">${items.map((i) => card(i.slug, `Role ${i.slug}`)).join("")}</nfj-postings-list>
    <script id="serverApp-state" type="application/json">${JSON.stringify(state)}</script></html>`
}

const base: SearchOpts = { query: "php", page: 1, dates: false, format: "json" }

describe("search output", () => {
  test("json carries the meta block and every contract field", async () => {
    mockSite(() => listPage([{ slug: "a-1", posted: day(1) }, { slug: "b-2", posted: day(2) }]))
    const out = capture("stdout")
    expect(await runSearch(base)).toBe(0)
    const parsed = JSON.parse(out())
    expect(parsed.meta).toEqual({ count: 2, page: 1, total: 2, truncated: false })
    const r = parsed.results[0]
    for (const key of ["id", "title", "company", "location", "date", "url", "salary", "tags"]) {
      expect(r).toHaveProperty(key)
    }
    expect(r.id).toBe("a-1")
    expect(r.url).toBe("https://nofluffjobs.com/job/a-1")
    expect(r.company).toBe("Acme")
    expect(r.date).toBe(day(1))
    expect(r.salary).toMatchObject({ from: 900, to: 1100, currency: "PLN" })
  })

  test("table prints a header and one row per offer", async () => {
    mockSite(() => listPage([{ slug: "a-1" }]))
    const out = capture("stdout")
    expect(await runSearch({ ...base, format: "table" })).toBe(0)
    const lines = out().trimEnd().split("\n")
    expect(lines[0]).toContain("TITLE")
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain("Role a-1")
  })

  test("plain prints title, company and url per offer", async () => {
    mockSite(() => listPage([{ slug: "a-1" }]))
    const out = capture("stdout")
    expect(await runSearch({ ...base, format: "plain" })).toBe(0)
    expect(out()).toContain("Role a-1")
    expect(out()).toContain("Acme")
    expect(out()).toContain("https://nofluffjobs.com/job/a-1")
  })

  test("a 404 list page exits 1 with NOT_FOUND, not an empty success", async () => {
    mockSite(() => [404, ""])
    const out = capture("stdout")
    const err = capture("stderr")
    expect(await runSearch(base)).toBe(1)
    expect(out()).toBe("")
    expect(JSON.parse(err()).code).toBe("NOT_FOUND")
  })

  test("--limit caps the emitted results", async () => {
    mockSite(() => listPage([{ slug: "a-1" }, { slug: "b-2" }, { slug: "c-3" }]))
    const out = capture("stdout")
    await runSearch({ ...base, limit: 2 })
    expect(JSON.parse(out()).results).toHaveLength(2)
  })

  test("duplicate cards are listed once", async () => {
    mockSite(() => listPage([{ slug: "a-1" }, { slug: "a-1" }, { slug: "b-2" }]))
    const out = capture("stdout")
    await runSearch(base)
    expect(JSON.parse(out()).results.map((r: { id: string }) => r.id)).toEqual(["a-1", "b-2"])
  })

  test("filters go into the criteria parameter, newest first", async () => {
    const urls = mockSite(() => listPage([]))
    capture("stdout")
    capture("stderr") // an empty page has no card marker, so the search reports PARSE_FAILED; only the URL matters here
    await runSearch({ ...base, query: "php symfony", location: "Kraków", category: "backend", seniority: "senior" })
    expect(urls).toHaveLength(1)
    const u = new URL(urls[0]!)
    expect(u.origin + u.pathname).toBe("https://nofluffjobs.com/pl")
    expect(u.searchParams.get("criteria")).toBe("keyword=php symfony city=krakow category=backend seniority=senior")
    expect(u.searchParams.get("sort")).toBe("newest")
    expect(urls[0]).toContain("criteria=keyword%3Dphp%20symfony")
    expect(u.searchParams.has("page")).toBe(false)
  })

  test("--page N requests that page; --all requests the 10-page view in one request", async () => {
    const urls = mockSite(() => listPage([]))
    capture("stdout")
    capture("stderr") // as above: only the requested URLs matter here
    await runSearch({ ...base, page: 3 })
    await runSearch({ ...base, all: true })
    expect(new URL(urls[0]!).searchParams.get("page")).toBe("3")
    expect(urls).toHaveLength(2)
    expect(new URL(urls[1]!).searchParams.get("page")).toBe(String(MAX_PAGES))
  })

  test("--all warns PAGE_CAP_REACHED when the portal holds more matches than were read", async () => {
    mockSite(() => listPage([{ slug: "a-1" }, { slug: "b-2" }], 350))
    const out = capture("stdout")
    const err = capture("stderr")
    await runSearch({ ...base, all: true })
    expect(JSON.parse(out()).meta).toMatchObject({ total: 350, truncated: true })
    expect(JSON.parse(err().trim()).code).toBe("PAGE_CAP_REACHED")
  })

  test("--jobage uses the dates in the page state and drops older offers", async () => {
    const urls = mockSite(() => listPage([{ slug: "a-1", posted: day(1) }, { slug: "b-2", posted: day(40) }]))
    const out = capture("stdout")
    await runSearch({ ...base, jobage: 14, dates: true })
    expect(JSON.parse(out()).results.map((r: { id: string }) => r.id)).toEqual(["a-1"])
    expect(urls).toHaveLength(1) // dated cards need no detail request
  })

  test("--dates fetches a detail page only for undated offers", async () => {
    const urls = mockSite((u) =>
      u.pathname.startsWith("/job/")
        ? detailPage({ datePosted: "2026-10-20" })
        : listPage([{ slug: "a-1", posted: day(1) }, { slug: "b-2" }]),
    )
    const out = capture("stdout")
    await runSearch({ ...base, dates: true })
    const results = JSON.parse(out()).results
    expect(results.map((r: { date: string }) => r.date)).toEqual([day(1), "2026-10-20"])
    expect(urls).toEqual([expect.stringContaining("/pl?"), "https://nofluffjobs.com/job/b-2"])
  })

  test(`date lookups are capped at ${MAX_ENRICHED} detail requests per search`, async () => {
    const items = Array.from({ length: MAX_ENRICHED + 5 }, (_, i) => ({ slug: `s-${i}` }))
    const urls = mockSite((u) => (u.pathname.startsWith("/job/") ? detailPage({ datePosted: "2026-10-20" }) : listPage(items)))
    capture("stdout")
    await runSearch({ ...base, dates: true })
    expect(urls.filter((u) => u.includes("/job/"))).toHaveLength(MAX_ENRICHED)
  })

  test("a failed date lookup keeps the offer with a null date", async () => {
    mockSite((u) => (u.pathname.startsWith("/job/") ? [403, "blocked"] : listPage([{ slug: "a-1" }])))
    const out = capture("stdout")
    expect(await runSearch({ ...base, dates: true })).toBe(0)
    expect(JSON.parse(out()).results[0].date).toBeNull()
  })

  test("only contacts nofluffjobs.com", async () => {
    const urls = mockSite((u) => (u.pathname.startsWith("/job/") ? detailPage({}) : listPage([{ slug: "a-1" }])))
    capture("stdout")
    await runSearch({ ...base, dates: true })
    for (const u of urls) expect(new URL(u).hostname).toBe("nofluffjobs.com")
  })

  test("a page with no posting cards exits 1 with PARSE_FAILED", async () => {
    mockSite(() => "<html><body>maintenance</body></html>")
    const err = capture("stderr")
    expect(await runSearch(base)).toBe(1)
    expect(JSON.parse(err()).code).toBe("PARSE_FAILED")
  })

  test("a 403 exits 1 with FETCH_FAILED", async () => {
    mockSite(() => [403, "blocked"])
    const err = capture("stderr")
    expect(await runSearch(base)).toBe(1)
    expect(JSON.parse(err()).code).toBe("FETCH_FAILED")
  })
})

function detailPage(over: { datePosted?: string; title?: string } = {}): string {
  const posting = {
    "@type": "JobPosting",
    title: over.title ?? "Senior PHP Developer",
    datePosted: over.datePosted,
    employmentType: "FULL_TIME",
    hiringOrganization: { name: "Acme" },
    jobLocation: { address: { addressLocality: "Warszawa", streetAddress: "Prosta 1" } },
  }
  return `<html><script type="application/ld+json">${JSON.stringify(posting)}</script>
    <section id="posting-requirements"><p>PHP 8 &amp; Symfony</p></section>
    <section id="posting-tasks"><ul><li>Build APIs</li></ul></section>
    <section id="posting-description"><p>Opis stanowiska</p></section></html>`
}

const slug = "senior-php-dev-acme-warszawa"

describe("detail output", () => {
  test("json returns the parsed offer fetched by slug", async () => {
    const urls = mockSite(() => detailPage({ datePosted: "2026-10-20" }))
    const out = capture("stdout")
    expect(await runDetail({ id: slug, format: "json" })).toBe(0)
    expect(urls).toEqual([`https://nofluffjobs.com/job/${slug}`])
    const d = JSON.parse(out())
    expect(d.id).toBe(slug)
    expect(d.title).toBe("Senior PHP Developer")
    expect(d.company).toBe("Acme")
    expect(d.date).toBe("2026-10-20")
    expect(d.requirements).toContain("PHP 8 & Symfony")
    expect(d.tasks).toContain("- Build APIs")
    expect(d.description).toContain("Opis stanowiska")
    for (const field of [d.requirements, d.tasks, d.description]) expect(field).not.toMatch(/<[a-z][^>]*>|&amp;|id="posting-/i)
  })

  test("plain prints the header line, sections and url", async () => {
    mockSite(() => detailPage({ datePosted: "2026-10-20" }))
    const out = capture("stdout")
    expect(await runDetail({ id: slug, format: "plain" })).toBe(0)
    expect(out()).toContain("Senior PHP Developer")
    expect(out()).toContain("posted 2026-10-20")
    expect(out()).toContain("Opis stanowiska")
    expect(out()).toContain(`https://nofluffjobs.com/job/${slug}`)
  })

  test("a full offer URL is fetched from its own slug", async () => {
    const urls = mockSite(() => detailPage())
    capture("stdout")
    await runDetail({ id: `https://nofluffjobs.com/pl/job/${slug}`, format: "json" })
    expect(urls).toEqual([`https://nofluffjobs.com/job/${slug}`])
  })

  test("a 404 exits 1 with NOT_FOUND", async () => {
    mockSite(() => [404, ""])
    const err = capture("stderr")
    expect(await runDetail({ id: slug, format: "json" })).toBe(1)
    expect(JSON.parse(err()).code).toBe("NOT_FOUND")
  })

  test("a page with no offer data exits 1 with PARSE_FAILED", async () => {
    mockSite(() => "<html><body>gone</body></html>")
    const err = capture("stderr")
    expect(await runDetail({ id: slug, format: "json" })).toBe(1)
    expect(JSON.parse(err()).code).toBe("PARSE_FAILED")
  })

  test("a 403 exits 1 with FETCH_FAILED", async () => {
    mockSite(() => [403, "blocked"])
    const err = capture("stderr")
    expect(await runDetail({ id: slug, format: "json" })).toBe(1)
    expect(JSON.parse(err()).code).toBe("FETCH_FAILED")
  })
})

describe("detail slug safety", () => {
  test("a path-escaping slug is refused before any request is made", async () => {
    const urls = mockSite(() => "<html></html>")
    const err = capture("stderr")
    for (const id of ["../api", "..%2Fapi", "a/../../api", "https://nofluffjobs.com/job/.."]) {
      expect(await runDetail({ id, format: "json" })).toBe(1)
    }
    expect(urls).toEqual([])
    expect(err()).toContain("BAD_ARG")
  })
})
