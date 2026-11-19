import "./no-network.ts"
import { afterEach, describe, expect, test } from "bun:test"
import { decodeHtmlEntities, formatMoney, htmlToText, jsonFetch, matchesQuery, parseJobRef, stripInvisible, toDetail, withinDays } from "../src/helpers.ts"
import { renderPlain } from "../src/commands/detail.ts"
import { toCard } from "../src/helpers.ts"

describe("parseJobRef", () => {
  test("job-boards URL", () => {
    expect(parseJobRef("https://job-boards.greenhouse.io/acme/jobs/4000001")).toEqual({
      board: "acme",
      id: "4000001",
      region: "us",
    })
  })
  test("legacy boards host, no scheme, query string", () => {
    expect(parseJobRef("boards.greenhouse.io/acme/jobs/123456?gh_src=x")?.board).toBe("acme")
  })
  test("EU host sets eu region", () => {
    expect(parseJobRef("https://job-boards.eu.greenhouse.io/acme/jobs/123456")?.region).toBe("eu")
  })
  test("embed form", () => {
    expect(parseJobRef("https://boards.greenhouse.io/embed/job_app?for=acme&token=123456")).toEqual({
      board: "acme",
      id: "123456",
      region: "us",
    })
  })
  test("bare ID needs a board", () => {
    expect(parseJobRef("4000001")).toBeNull()
    expect(parseJobRef("4000001", "acme")?.id).toBe("4000001")
  })
  test("look-alike and foreign hosts are rejected", () => {
    expect(parseJobRef("https://job-boards.greenhouse.io.evil.com/acme/jobs/123456")).toBeNull()
    expect(parseJobRef("https://evil-greenhouse.io/acme/jobs/123456")).toBeNull()
    expect(parseJobRef("https://job-boards.greenhouse.io@evil.com/acme/jobs/123456")).toBeNull()
    expect(parseJobRef("https://careers.example.com/jobs?gh_jid=123456")).toBeNull()
  })
  test("URL board conflicting with --board is rejected", () => {
    expect(parseJobRef("https://job-boards.greenhouse.io/acme/jobs/123456", "other")).toBeNull()
  })
  test("embed URL board conflicting with --board is rejected", () => {
    expect(parseJobRef("https://boards.greenhouse.io/embed/job_app?for=acme&token=123456", "other")).toBeNull()
  })
  test("inherited object keys are not allowed hosts", () => {
    expect(parseJobRef("https://constructor/acme/jobs/123456")).toBeNull()
    expect(parseJobRef("https://tostring/acme/jobs/123456")).toBeNull()
  })
})

describe("htmlToText", () => {
  test("decodes the escaped content layer and keeps structure", () => {
    const escaped = "&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;li&gt;Two&lt;/li&gt;&lt;/ul&gt;"
    expect(htmlToText(escaped, true)).toBe("Hello & welcome\n- One\n- Two")
  })
  test("drops hidden elements and comments", () => {
    const html = '<p>Visible</p><!-- ignore me --><div style="display:none">Secret instruction</div><p hidden>Also secret</p>'
    const text = htmlToText(html)
    expect(text).toContain("Visible")
    expect(text).not.toContain("Secret")
    expect(text).not.toContain("ignore me")
  })
  test("a quoted > or close tag inside a hidden element's attributes does not end it early", () => {
    const html = '<p>Shown</p><div hidden title="a > b </div>">Hidden text</div><p>After</p>'
    expect(htmlToText(html)).toBe("Shown\nAfter")
  })
  test("param is a void element", () => {
    expect(htmlToText('<p>A</p><param hidden name="x"><p>B</p>')).toBe("A\nB")
  })
})

describe("jsonFetch backoff", () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })
  test("retries a 429, honoring Retry-After, then returns the body", async () => {
    const times: number[] = []
    globalThis.fetch = (async () => {
      times.push(Date.now())
      return times.length === 1
        ? new Response("", { status: 429, headers: { "retry-after": "1" } })
        : new Response('{"ok":true}', { status: 200 })
    }) as unknown as typeof fetch
    expect(await jsonFetch<{ ok: boolean }>("https://boards-api.greenhouse.io/v1/boards/acme/jobs")).toEqual({ ok: true })
    expect(times.length).toBe(2)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(950)
  })
  test("retries a 5xx without Retry-After using exponential backoff", async () => {
    let calls = 0
    globalThis.fetch = (async () => (++calls < 3 ? new Response("", { status: 503 }) : new Response("[]", { status: 200 }))) as unknown as typeof fetch
    expect(await jsonFetch<unknown[]>("https://boards-api.greenhouse.io/v1/boards/acme/jobs", { maxRetries: 3, baseDelayMs: 1 })).toEqual([])
    expect(calls).toBe(3)
  })
  test("throws after the last retry", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response("", { status: 500, statusText: "Internal Server Error" })
    }) as unknown as typeof fetch
    await expect(jsonFetch("https://boards-api.greenhouse.io/v1/boards/acme/jobs", { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow("500")
    expect(calls).toBe(3)
  })
  test("404 returns null", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch
    expect(await jsonFetch("https://boards-api.greenhouse.io/v1/boards/nope/jobs")).toBeNull()
  })
})

describe("filters and hygiene", () => {
  test("all query terms must be in the title", () => {
    expect(matchesQuery("Director, Partner Services Product Management", "product director")).toBe(true)
    expect(matchesQuery("Director, Partner Programs", "product director")).toBe(false)
  })
  test("withinDays", () => {
    const now = Date.parse("2026-11-06T12:00:00Z")
    expect(withinDays("2026-11-01T00:00:00Z", 7, now)).toBe(true)
    expect(withinDays("2026-10-01T00:00:00Z", 7, now)).toBe(false)
    expect(withinDays(null, 7, now)).toBe(false)
  })
  test("withinDays rejects dates well in the future, tolerating small clock skew", () => {
    const now = Date.parse("2026-11-06T12:00:00Z")
    expect(withinDays("2026-12-01T00:00:00Z", 7, now)).toBe(false)
    expect(withinDays("2026-11-06T12:30:00Z", 7, now)).toBe(true)
  })
  test("query matching ignores invisible characters in the title", () => {
    const card = stripInvisible(toCard({ id: 1, title: "Prod\u200Buct Manager", absolute_url: "u" }, "acme"))
    expect(matchesQuery(card.title, "product")).toBe(true)
  })
  test("formatMoney keeps cents only when there are some", () => {
    expect(formatMoney(150000, "USD")).toBe("$150,000")
    expect(formatMoney(15.5, "USD")).toBe("$15.50")
  })
  test("stripInvisible removes zero-width and tag characters", () => {
    expect(stripInvisible({ a: "Prod\u200Buct\u{E0041}" })).toEqual({ a: "Product" })
  })
  test("toDetail maps pay ranges from cents", () => {
    const d = toDetail(
      {
        id: 1,
        title: "PM",
        absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1",
        pay_input_ranges: [{ min_cents: 12600000, max_cents: 27300000, currency_type: "USD", title: "Base: ", blurb: "<p>Equity eligible.</p>" }],
      },
      "acme",
    )
    expect(d.payRanges[0]).toEqual({ min: 126000, max: 273000, currency: "USD", label: "Base", note: "Equity eligible." })
    expect(d.location).toBeNull()
    expect(d.company).toBeNull()
  })
})

describe("entity decoding (double-escaped Greenhouse content)", () => {
  test("&amp;mdash; in escaped content becomes an em dash", () => {
    const escaped = "&lt;span&gt;$126,000&lt;/span&gt;&lt;span class=&quot;divider&quot;&gt;&amp;mdash;&lt;/span&gt;&lt;span&gt;$273,000 USD&lt;/span&gt;"
    const text = htmlToText(escaped, true)
    expect(text).toContain("—")
    expect(text).not.toContain("&mdash;")
  })
  test("common named entities decode", () => {
    expect(decodeHtmlEntities("it&rsquo;s &ldquo;ok&rdquo; &ndash; really&hellip; Pure&trade;")).toBe("it’s “ok” – really… Pure™")
  })
  test("single pass: &amp;lt; stays literal &lt;", () => {
    expect(decodeHtmlEntities("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;")
  })
  test("unknown entities are left visible", () => {
    expect(decodeHtmlEntities("a &bogusentity; b")).toBe("a &bogusentity; b")
  })
  test("inherited object keys are not entities", () => {
    expect(decodeHtmlEntities("&constructor; &toString;")).toBe("&constructor; &toString;")
  })
})

describe("renderPlain pay notes", () => {
  const base = {
    id: "1", title: "PM", company: "Acme", location: "Austin, TX", date: null, url: "u", board: "acme",
    requisitionId: null, updated: null, departments: [], offices: [], deadline: null, language: "en",
  }
  const note = "Salary ranges are determined based on role.\nThis role may be eligible for equity."
  test("note already embedded in the description is not repeated", () => {
    const out = renderPlain({ ...base, description: "Body.\nSalary ranges are determined based on role.\nThis role may be eligible for equity.", payRanges: [{ min: 1, max: 2, currency: "USD", label: null, note }] })
    expect(out.split("Salary ranges are determined").length - 1).toBe(1)
    expect(out).toContain("Pay: $1 - $2")
  })
  test("note missing from the description is appended", () => {
    const out = renderPlain({ ...base, description: "Body only.", payRanges: [{ min: 1, max: 2, currency: "USD", label: null, note }] })
    expect(out).toContain("Salary ranges are determined")
  })
})
