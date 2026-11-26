import "./no-network.ts"
import { afterEach, describe, expect, test } from "bun:test"
import {
  decodeHtmlEntities,
  employmentLabel,
  foldPostings,
  htmlToText,
  isShortlink,
  jsonFetch,
  locationLine,
  matchesQuery,
  matchesWorkplace,
  parseJobRef,
  parseRetryAfter,
  parseWorkplace,
  stripInvisible,
  toDetail,
  withinDays,
} from "../src/helpers.ts"
import { renderPlain } from "../src/commands/detail.ts"
import { renderTable } from "../src/commands/search.ts"

describe("parseJobRef", () => {
  test("board URL", () => {
    expect(parseJobRef("https://apply.workable.com/acme/j/PM00000001")).toEqual({ board: "acme", id: "PM00000001" })
  })
  test("board URL with /apply and query string", () => {
    expect(parseJobRef("https://apply.workable.com/acme/j/PM00000001/apply?utm=x")?.id).toBe("PM00000001")
  })
  test("API URL form, v1 and v2", () => {
    expect(parseJobRef("https://apply.workable.com/api/v1/accounts/acme/jobs/PM00000001")?.board).toBe("acme")
    expect(parseJobRef("https://apply.workable.com/api/v2/accounts/acme/jobs/PM00000001")?.board).toBe("acme")
  })
  test("legacy tenant host", () => {
    expect(parseJobRef("https://acme.workable.com/j/PM00000001")).toEqual({ board: "acme", id: "PM00000001" })
  })
  test("www and bare-domain share links need a board", () => {
    expect(parseJobRef("https://www.workable.com/j/PM00000001")).toBeNull()
    expect(parseJobRef("https://www.workable.com/j/PM00000001", "acme")).toEqual({ board: "acme", id: "PM00000001" })
    expect(parseJobRef("https://workable.com/j/PM00000001", "acme")?.id).toBe("PM00000001")
  })
  test("shortlink needs a board", () => {
    expect(parseJobRef("https://apply.workable.com/j/PM00000001")).toBeNull()
    expect(parseJobRef("https://apply.workable.com/j/PM00000001", "acme")?.board).toBe("acme")
  })
  test("bare shortcode needs a board", () => {
    expect(parseJobRef("PM00000001")).toBeNull()
    expect(parseJobRef("PM00000001", "acme")?.id).toBe("PM00000001")
  })
  test("look-alike and foreign hosts are rejected", () => {
    expect(parseJobRef("https://apply.workable.com.evil.com/acme/j/PM00000001")).toBeNull()
    expect(parseJobRef("https://evil-workable.com/acme/j/PM00000001")).toBeNull()
    expect(parseJobRef("https://apply.workable.com@evil.com/acme/j/PM00000001")).toBeNull()
    expect(parseJobRef("https://www.workable.com.evil.com/j/PM00000001", "acme")).toBeNull()
  })
  test("invalid slug or shortcode is rejected", () => {
    expect(parseJobRef("https://apply.workable.com/a.b/j/PM00000001")).toBeNull()
    expect(parseJobRef("https://apply.workable.com/acme/j/PM-000001")).toBeNull()
  })
  test("URL board conflicting with --board is rejected", () => {
    expect(parseJobRef("https://apply.workable.com/acme/j/PM00000001", "other")).toBeNull()
  })
  test("isShortlink", () => {
    expect(isShortlink("https://apply.workable.com/j/PM00000001")).toBe(true)
    expect(isShortlink("https://www.workable.com/j/PM00000001")).toBe(true)
    expect(isShortlink("https://workable.com/j/PM00000001")).toBe(true)
    expect(isShortlink("https://apply.workable.com/acme/j/PM00000001")).toBe(false)
    expect(isShortlink("https://www.workable.com.evil.com/j/PM00000001")).toBe(false)
  })
})

describe("htmlToText", () => {
  test("keeps structure and decodes entities", () => {
    expect(htmlToText("<p>Hello &amp; welcome</p><ul><li>One</li><li>Two</li></ul>")).toBe("Hello & welcome\n- One\n- Two")
  })
  test("drops hidden elements, comments and script blocks", () => {
    const html = '<p>Visible</p><!-- ignore me --><div style="display:none">Secret instruction</div><p hidden>Also secret</p><script>alert(1)</script>'
    const text = htmlToText(html)
    expect(text).toContain("Visible")
    expect(text).not.toContain("Secret")
    expect(text).not.toContain("ignore me")
    expect(text).not.toContain("alert")
  })
  test("drops elements hidden by HTML-encoded CSS markers", () => {
    expect(htmlToText('<p>Shown</p><div style="display&#58;none">Numeric</div>')).toBe("Shown")
    expect(htmlToText('<p>Shown</p><div style="visibility&colon;hidden">Named</div>')).toBe("Shown")
  })
  test("a quoted > or close tag inside a hidden element's attributes does not end it early", () => {
    const html = '<p>Shown</p><div hidden title="a > b </div>">Hidden text</div><p>After</p>'
    expect(htmlToText(html)).toBe("Shown\nAfter")
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
    expect(await jsonFetch<{ ok: boolean }>("https://apply.workable.com/api/v1/widget/accounts/acme")).toEqual({ ok: true })
    expect(times.length).toBe(2)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(950)
  })
  test("retries a 429 with an HTTP-date Retry-After", async () => {
    const times: number[] = []
    globalThis.fetch = (async () => {
      times.push(Date.now())
      return times.length === 1
        ? new Response("", { status: 429, headers: { "retry-after": new Date(Date.now() + 2000).toUTCString() } })
        : new Response('{"ok":true}', { status: 200 })
    }) as unknown as typeof fetch
    expect(await jsonFetch<{ ok: boolean }>("https://apply.workable.com/api/v1/widget/accounts/acme")).toEqual({ ok: true })
    expect(times.length).toBe(2)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(950)
  })
  test("parseRetryAfter reads seconds and HTTP-dates", () => {
    const now = Date.parse("2026-11-25T00:44:30Z")
    expect(parseRetryAfter("120", now)).toBe(120000)
    expect(parseRetryAfter("0", now)).toBe(0)
    expect(parseRetryAfter("-1", now)).toBeNull()
    expect(parseRetryAfter("Wed, 25 Nov 2026 00:45:00 GMT", now)).toBe(30000)
    expect(parseRetryAfter("nonsense", now)).toBeNull()
    expect(parseRetryAfter(null, now)).toBeNull()
  })
  test("retries a 5xx without Retry-After using exponential backoff", async () => {
    let calls = 0
    globalThis.fetch = (async () => (++calls < 3 ? new Response("", { status: 503 }) : new Response("[]", { status: 200 }))) as unknown as typeof fetch
    expect(await jsonFetch<unknown[]>("https://apply.workable.com/api/v1/widget/accounts/acme", { maxRetries: 3, baseDelayMs: 1 })).toEqual([])
    expect(calls).toBe(3)
  })
  test("throws after the last retry", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response("", { status: 500, statusText: "Internal Server Error" })
    }) as unknown as typeof fetch
    await expect(jsonFetch("https://apply.workable.com/api/v1/widget/accounts/acme", { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow("500")
    expect(calls).toBe(3)
  })
  test("404 returns null", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch
    expect(await jsonFetch("https://apply.workable.com/api/v1/widget/accounts/nope")).toBeNull()
  })
})

describe("folding and filtering", () => {
  const board = {
    name: "Acme Robotics",
    jobs: [
      { title: "PM", shortcode: "AAA111", city: "London", state: "England", country: "United Kingdom", department: "Product", employment_type: "Full-time", code: "R-1", workplace_type: "on_site", published_on: "2026-11-10" },
      { title: "PM", shortcode: "AAA111", city: "", state: "", country: "Romania", published_on: "2026-11-10" },
      { title: "Engineer", shortcode: "BBB222", city: "", state: "", country: "United States", telecommuting: true, published_on: "2026-11-18" },
      { title: "", shortcode: "CCC333" },
      { title: "No shortcode" },
    ],
  }
  test("one posting per shortcode, locations joined, Remote once", () => {
    const cards = foldPostings(board, "acme")
    expect(cards.map((c) => c.id)).toEqual(["AAA111", "BBB222"])
    expect(cards[0].location).toBe("London, England, United Kingdom · Romania")
    expect(cards[1].location).toBe("United States · Remote")
    expect(cards[0].company).toBe("Acme Robotics")
    expect(cards[0].url).toBe("https://apply.workable.com/acme/j/AAA111")
    expect(cards[0]).toMatchObject({ department: "Product", employmentType: "Full-time", requisitionId: "R-1", workplace: "onsite" })
    expect(cards[1]).toMatchObject({ department: null, employmentType: null, requisitionId: null, workplace: "remote" })
  })
  test("falls back to the board slug when the name is blank", () => {
    const cards = foldPostings({ name: "  ", jobs: [{ title: "PM", shortcode: "EEE555" }] }, "acme")
    expect(cards).toHaveLength(1)
    expect(cards[0].company).toBe("acme")
  })
  test("a sibling's telecommuting flag or workplace_type fills the first row's gap", () => {
    const [remote] = foldPostings(
      {
        jobs: [
          { title: "X", shortcode: "FFF666", country: "United States", telecommuting: false },
          { title: "X", shortcode: "FFF666", country: "United States", telecommuting: true },
        ],
      },
      "acme",
    )
    expect(remote.location).toBe("United States · Remote")
    expect(remote.workplace).toBe("remote")

    const [hybrid] = foldPostings(
      {
        jobs: [
          { title: "X", shortcode: "GGG777", country: "Germany", telecommuting: false },
          { title: "X", shortcode: "GGG777", country: "Germany", workplace_type: "hybrid" },
        ],
      },
      "acme",
    )
    expect(hybrid.workplace).toBe("hybrid")
  })
  test("a malformed enum field does not abort the fold", () => {
    const [card] = foldPostings(
      {
        name: 42 as unknown as string,
        jobs: [
          {
            title: "X",
            shortcode: "III999",
            workplace_type: 42 as unknown as string,
            employment_type: 42 as unknown as string,
            telecommuting: true,
          },
        ],
      },
      "acme",
    )
    expect(card.company).toBe("acme")
    expect(card.workplace).toBe("remote")
    expect(card.employmentType).toBeNull()
  })
  test("falls back to the row's locations[] when the flat fields are blank", () => {
    const cards = foldPostings(
      { jobs: [{ title: "PM", shortcode: "DDD444", locations: [{ city: "Oslo", country: "Norway" }] }] },
      "acme",
    )
    expect(cards[0].location).toBe("Oslo, Norway")
  })
  test("locationLine keeps the region when the city is set, and dedupes a region equal to the city", () => {
    expect(locationLine({ city: "Austin", region: "Texas", country: "United States" })).toBe("Austin, Texas, United States")
    expect(locationLine({ city: "New York", region: "New York", country: "United States" })).toBe("New York, United States")
    expect(locationLine({ city: "", region: "Queensland", country: "Australia" })).toBe("Queensland, Australia")
    expect(locationLine(null)).toBe("")
  })
  test("all query terms must be in the title", () => {
    expect(matchesQuery("Director, Partner Services Product Management", "product director")).toBe(true)
    expect(matchesQuery("Director, Partner Programs", "product director")).toBe(false)
  })
  test("withinDays", () => {
    const now = Date.parse("2026-11-20T12:00:00Z")
    expect(withinDays("2026-11-18", 7, now)).toBe(true)
    expect(withinDays("2026-10-01", 7, now)).toBe(false)
    expect(withinDays(null, 7, now)).toBe(false)
  })
  test("withinDays rejects dates well in the future, tolerating small clock skew", () => {
    const now = Date.parse("2026-11-20T12:00:00Z")
    expect(withinDays("2026-12-01T00:00:00Z", 7, now)).toBe(false)
    expect(withinDays("2026-11-20T12:30:00Z", 7, now)).toBe(true)
  })
  test("query matching ignores invisible characters in the title", () => {
    const card = stripInvisible(foldPostings({ jobs: [{ title: "Prod\u200Buct Manager", shortcode: "AAA111" }] }, "acme")[0])
    expect(matchesQuery(card.title, "product")).toBe(true)
  })
  test("employmentLabel maps known types and keeps unknown ones", () => {
    expect(employmentLabel("full")).toBe("Full-time")
    expect(employmentLabel("part")).toBe("Part-time")
    expect(employmentLabel("seasonal")).toBe("seasonal")
    expect(employmentLabel(null)).toBeNull()
    expect(employmentLabel(42 as unknown as string)).toBeNull()
  })
  test("parseWorkplace normalizes Workable's spellings", () => {
    expect(parseWorkplace("remote")).toBe("remote")
    expect(parseWorkplace("Hybrid")).toBe("hybrid")
    expect(parseWorkplace("on_site")).toBe("onsite")
    expect(parseWorkplace("on-site")).toBe("onsite")
    expect(parseWorkplace("onsite")).toBe("onsite")
    expect(parseWorkplace("elsewhere")).toBeNull()
    expect(parseWorkplace(null)).toBeNull()
    expect(parseWorkplace(42 as unknown as string)).toBeNull()
  })
  test("matchesWorkplace only matches known values", () => {
    expect(matchesWorkplace("remote", undefined)).toBe(true)
    expect(matchesWorkplace("remote", "remote")).toBe(true)
    expect(matchesWorkplace(null, "hybrid")).toBe(false)
    expect(matchesWorkplace("onsite", "hybrid")).toBe(false)
  })
  test("stripInvisible removes zero-width and tag characters", () => {
    expect(stripInvisible({ a: "Prod\u200Buct\u{E0041}" })).toEqual({ a: "Product" })
  })
})

describe("table", () => {
  test("widens the ID column for long shortcodes", () => {
    const card = {
      id: "ABCDEFGHIJKLMNOPQRST",
      title: "Engineer",
      company: "Acme",
      location: "Berlin, Germany",
      date: "2026-11-10",
      url: "https://apply.workable.com/acme/j/ABCDEFGHIJKLMNOPQRST",
      board: "acme",
      department: "Product",
      employmentType: "Full-time",
      requisitionId: "R-1",
      workplace: "remote" as const,
    }
    const [header, separator, row] = renderTable([card]).split("\n")
    expect(row.length).toBe(header.length)
    expect(separator.length).toBe(header.length)
  })
})

describe("detail mapping", () => {
  const job = {
    shortcode: "AAA111",
    title: "PM",
    remote: true,
    locations: [{ city: "London", country: "United Kingdom" }, { country: "Romania" }],
    published: "2026-11-10T00:00:00.000Z",
    type: "full",
    code: "R-1",
    language: "en",
    department: ["Product", " "],
    workplace: "remote",
    description: "<p>Body</p>",
    requirements: "<ul><li>Req</li></ul>",
    benefits: null,
  }
  test("maps fields, joins locations and marks remote", () => {
    const d = toDetail(job, "acme")
    expect(d).toMatchObject({
      id: "AAA111",
      company: "acme",
      location: "London, United Kingdom · Romania · Remote",
      employmentType: "Full-time",
      department: "Product",
      departments: ["Product"],
      requisitionId: "R-1",
      workplace: "remote",
      description: "Body",
      requirements: "- Req",
      benefits: null,
      remote: true,
    })
    expect(d.url).toBe("https://apply.workable.com/acme/j/AAA111")
  })
  test("plain output separates requirements and benefits", () => {
    const out = renderPlain(toDetail(job, "acme"))
    expect(out).toContain("Body\n\nRequirements\n- Req")
    expect(out).not.toContain("Benefits")
    expect(out).toContain("Workplace: remote")
    expect(out).toContain("Posted: 2026-11-10")
  })
})

describe("entity decoding", () => {
  test("common named entities decode", () => {
    expect(decodeHtmlEntities("it&rsquo;s &ldquo;ok&rdquo; &ndash; really&hellip; Pure&trade;")).toBe("it’s “ok” – really… Pure™")
    expect(decodeHtmlEntities("a&colon;b&semi;c")).toBe("a:b;c")
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
