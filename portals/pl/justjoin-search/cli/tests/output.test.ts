import { afterEach, describe, expect, test } from "bun:test"
import { runDetail } from "../src/commands/detail.js"
import { runSearch, type SearchOpts } from "../src/commands/search.js"

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

const rsc = (...payloads: string[]) =>
  payloads.map((p) => `<script>self.__next_f.push([1,${JSON.stringify(p)}])</script>`).join("")

const day = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString()

const offer = (n: number, over: Record<string, unknown> = {}) => ({
  applyUrl: null,
  body: "$5b",
  city: "Opole",
  companyName: "BitBag",
  employmentTypes: [{ from: 8000, to: 12000, currency: "PLN", currencySource: "original", type: "b2b", unit: "month", gross: false }],
  experienceLevel: "mid",
  publishedAt: day(0),
  expiredAt: "2999-01-01T00:00:00Z",
  requiredSkills: ["Symfony", "PHP"],
  slug: `bitbag-role-${n}`,
  title: `Role ${n}`,
  workplaceType: "remote",
  ...over,
})

// A page with no matching offers still carries streamed page data, just no offer objects.
const listPage = (...offers: object[]) => rsc(offers.length ? offers.map((o) => JSON.stringify(o)).join(",") : '{"props":{}}')

const base: SearchOpts = { query: "php", jobage: 9999, format: "json" }

describe("search output", () => {
  test("json carries the meta block and every contract field", async () => {
    mockSite(() => listPage(offer(1), offer(2)))
    const out = capture("stdout")
    expect(await runSearch(base)).toBe(0)
    const parsed = JSON.parse(out())
    expect(parsed.meta).toEqual({ count: 2, page: 1 })
    const r = parsed.results[0]
    for (const key of ["id", "title", "company", "location", "date", "url", "workplaceType", "salary", "deadline", "skills"]) {
      expect(r).toHaveProperty(key)
    }
    expect(r.url).toBe("https://justjoin.it/job-offer/bitbag-role-1")
    expect(r.salary).toMatchObject({ from: 8000, to: 12000, currency: "PLN" })
  })

  test("table prints a header and one row per offer", async () => {
    mockSite(() => listPage(offer(1)))
    const out = capture("stdout")
    expect(await runSearch({ ...base, format: "table" })).toBe(0)
    const lines = out().trimEnd().split("\n")
    expect(lines[0]).toContain("TITLE")
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain("Role 1")
  })

  test("plain prints title, company and url per offer", async () => {
    mockSite(() => listPage(offer(1)))
    const out = capture("stdout")
    expect(await runSearch({ ...base, format: "plain" })).toBe(0)
    expect(out()).toContain("Role 1")
    expect(out()).toContain("BitBag")
    expect(out()).toContain("https://justjoin.it/job-offer/bitbag-role-1")
  })

  test("table marks a truncated title with an ellipsis and leaves short ones alone", async () => {
    const long = "A".repeat(60)
    mockSite(() => listPage(offer(1, { title: long }), offer(2)))
    const out = capture("stdout")
    await runSearch({ ...base, format: "table" })
    expect(out()).toContain("A".repeat(43) + "…")
    expect(out()).not.toContain("A".repeat(44))
    expect(out()).toContain("Role 2 ")
  })

  test("table and plain say so when nothing matches", async () => {
    mockSite(() => listPage())
    for (const format of ["table", "plain"] as const) {
      const out = capture("stdout")
      expect(await runSearch({ ...base, format })).toBe(0)
      expect(out().trim()).toBe("No offers found.")
    }
  })

  test("a 404 list page (unknown category or city) exits 1 with NOT_FOUND, not an empty success", async () => {
    mockSite(() => [404, ""])
    const out = capture("stdout")
    const err = capture("stderr")
    expect(await runSearch({ ...base, category: "no-such-category" })).toBe(1)
    expect(out()).toBe("")
    expect(JSON.parse(err()).code).toBe("NOT_FOUND")
  })

  test("--limit caps the emitted results", async () => {
    mockSite(() => listPage(offer(1), offer(2), offer(3)))
    const out = capture("stdout")
    await runSearch({ ...base, limit: 2 })
    expect(JSON.parse(out()).results).toHaveLength(2)
  })

  test("--jobage drops older offers client-side", async () => {
    mockSite(() => listPage(offer(1), offer(2, { publishedAt: day(40) })))
    const out = capture("stdout")
    await runSearch({ ...base, jobage: 14 })
    expect(JSON.parse(out()).results.map((r: { id: string }) => r.id)).toEqual(["bitbag-role-1"])
  })

  test("filters become path and query parameters of the list URL", async () => {
    const urls = mockSite(() => listPage())
    capture("stdout")
    await runSearch({
      query: "php", location: "Kraków", category: "php", workplace: "remote",
      experience: "senior", employmentType: "b2b", withSalary: true, jobage: 9999, format: "json",
    })
    expect(urls).toHaveLength(1)
    const u = new URL(urls[0]!)
    expect(u.origin).toBe("https://justjoin.it")
    expect(u.pathname).toBe("/job-offers/krakow/php")
    expect(u.searchParams.get("keyword")).toBe("php")
    expect(u.searchParams.get("workplace")).toBe("remote")
    expect(u.searchParams.get("experience-level")).toBe("senior")
    expect(u.searchParams.get("employment-type")).toBe("b2b")
    expect(u.searchParams.get("with-salary")).toBe("yes")
  })

  test("a page with no readable payload exits 1 with PARSE_FAILED", async () => {
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

const slug = "bitbag-role-1"
const BODY = "<p>Zakres</p><ul><li>API</li></ul>"

const detailPage = (over: Record<string, unknown> = {}) =>
  `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Role 1",
    datePosted: "2026-10-20",
    validThrough: "2999-01-01T00:00:00Z",
    hiringOrganization: { name: "BitBag" },
    jobLocation: { address: { addressLocality: "Opole", streetAddress: "Rynek 1" } },
  })}</script>` + rsc(`x:[{"offer":${JSON.stringify(offer(1, over))}}]`, `\n5b:T${BODY.length.toString(16)},${BODY}`)

describe("detail output", () => {
  test("json returns the parsed offer fetched by slug", async () => {
    const urls = mockSite(() => detailPage())
    const out = capture("stdout")
    expect(await runDetail({ id: slug, format: "json" })).toBe(0)
    expect(urls).toEqual([`https://justjoin.it/job-offer/${slug}`])
    const d = JSON.parse(out())
    expect(d.id).toBe(slug)
    expect(d.company).toBe("BitBag")
    expect(d.isActive).toBe(true)
    expect(d.description).toContain("Zakres")
    expect(d.description).toContain("- API")
    expect(d.description).not.toMatch(/<[a-z][^>]*>/i)
  })

  test("plain prints status, salary and url", async () => {
    mockSite(() => detailPage())
    const out = capture("stdout")
    expect(await runDetail({ id: slug, format: "plain" })).toBe(0)
    expect(out()).toContain("| open")
    expect(out()).toContain("salary:")
    expect(out()).toContain(`https://justjoin.it/job-offer/${slug}`)
  })

  test("a full offer URL is fetched from its own slug", async () => {
    const urls = mockSite(() => detailPage())
    capture("stdout")
    await runDetail({ id: `https://justjoin.it/job-offer/${slug}`, format: "json" })
    expect(urls).toEqual([`https://justjoin.it/job-offer/${slug}`])
  })

  test("plain output keeps the blank line before the description", async () => {
    mockSite(() => detailPage())
    const out = capture("stdout")
    await runDetail({ id: slug, format: "plain" })
    expect(out()).toContain(`https://justjoin.it/job-offer/${slug}\n\nZakres`)
    expect(out().endsWith("\n")).toBe(true)
  })

  test("an offer flagged inactive is reported as expired", async () => {
    mockSite(() => detailPage({ isOfferActive: false }))
    const out = capture("stdout")
    await runDetail({ id: slug, format: "json" })
    expect(JSON.parse(out()).isActive).toBe(false)
  })

  test("an embedded offer with a different slug is never reported under the requested slug", async () => {
    mockSite(() => rsc(`x:[{"offer":${JSON.stringify(offer(2))}}]`))
    const out = capture("stdout")
    const err = capture("stderr")
    expect(await runDetail({ id: slug, format: "json" })).toBe(1)
    expect(out()).toBe("")
    expect(JSON.parse(err()).code).toBe("PARSE_FAILED")
  })

  test("with JSON-LD present, a foreign embedded offer contributes none of its fields", async () => {
    mockSite(() => detailPage({ slug: "someone-else-9", title: "Other job", companyName: "OtherCo", workplaceType: "office" }))
    const out = capture("stdout")
    expect(await runDetail({ id: slug, format: "json" })).toBe(0)
    const d = JSON.parse(out())
    expect(d.id).toBe(slug)
    expect(d.title).toBe("Role 1")
    expect(d.workplaceType).toBeNull()
    expect(d.skills).toEqual([])
  })

  test("a path-escaping slug is refused before any request is made", async () => {
    const urls = mockSite(() => detailPage())
    const err = capture("stderr")
    for (const id of ["../api", "..%2Fapi", "a/../../api", "https://justjoin.it/job-offer/.."]) {
      expect(await runDetail({ id, format: "json" })).toBe(1)
    }
    expect(urls).toEqual([])
    expect(err()).toContain("BAD_ARG")
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
