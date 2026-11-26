import "./no-network.ts"
import { afterEach, describe, expect, test } from "bun:test"
import {
  decodeHtmlEntities,
  employmentLabel,
  htmlToText,
  jsonFetch,
  locationLine,
  matchesLocation,
  parseBoard,
  parseJobRef,
  parseRemoteModes,
  parseRetryAfter,
  postingUrl,
  stripInvisible,
  toCard,
  toDetail,
  withinDays,
} from "../src/helpers.ts"
import { renderPlain } from "../src/commands/detail.ts"
import { renderTable } from "../src/commands/search.ts"

describe("parseBoard", () => {
  test("bare identifier", () => {
    expect(parseBoard("BoschGroup")).toBe("BoschGroup")
    expect(parseBoard("  acme_robotics-1  ")).toBe("acme_robotics-1")
  })
  test("board, careers, posting and API URLs", () => {
    expect(parseBoard("https://jobs.smartrecruiters.com/BoschGroup")).toBe("BoschGroup")
    expect(parseBoard("https://careers.smartrecruiters.com/BoschGroup")).toBe("BoschGroup")
    expect(parseBoard("https://jobs.smartrecruiters.com/BoschGroup/744000163798847-some-title")).toBe("BoschGroup")
    expect(parseBoard("https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=1")).toBe("BoschGroup")
  })
  test("look-alike and foreign hosts are rejected", () => {
    expect(parseBoard("https://jobs.smartrecruiters.com.evil.com/BoschGroup")).toBeNull()
    expect(parseBoard("https://evil-smartrecruiters.com/BoschGroup")).toBeNull()
    expect(parseBoard("https://jobs.smartrecruiters.com@evil.com/BoschGroup")).toBeNull()
    expect(parseBoard("https://example.com/BoschGroup")).toBeNull()
  })
  test("invalid identifiers are rejected", () => {
    expect(parseBoard(".")).toBeNull()
    expect(parseBoard("..")).toBeNull()
    expect(parseBoard("a/b")).toBeNull()
    expect(parseBoard("")).toBeNull()
  })
})

describe("parseJobRef", () => {
  test("posting URL with and without a title slug", () => {
    expect(parseJobRef("https://jobs.smartrecruiters.com/BoschGroup/744000163798847-internship-in-human-resources")).toEqual({
      board: "BoschGroup",
      id: "744000163798847",
    })
    expect(parseJobRef("https://jobs.smartrecruiters.com/BoschGroup/744000163798847?oga=true")?.id).toBe("744000163798847")
  })
  test("careers and API URL forms", () => {
    expect(parseJobRef("https://careers.smartrecruiters.com/BoschGroup/744000163798847")?.board).toBe("BoschGroup")
    expect(parseJobRef("https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000163798847")?.id).toBe("744000163798847")
  })
  test("a UUID posting id keeps its hyphens", () => {
    const uuid = "4f049d2a-9f39-467e-ae4f-ba8a6107db58"
    expect(parseJobRef(`https://jobs.smartrecruiters.com/BoschGroup/${uuid}`)?.id).toBe(uuid)
  })
  test("a UUID posting link with a title slug keeps the whole UUID", () => {
    const uuid = "4f049d2a-9f39-467e-ae4f-ba8a6107db58"
    expect(parseJobRef(`https://jobs.smartrecruiters.com/BoschGroup/${uuid}-internship-in-human-resources`)?.id).toBe(uuid)
  })
  test("bare posting ID needs a board", () => {
    expect(parseJobRef("744000163798847")).toBeNull()
    expect(parseJobRef("744000163798847", "BoschGroup")?.board).toBe("BoschGroup")
  })
  test("URL board conflicting with --board is rejected", () => {
    expect(parseJobRef("https://jobs.smartrecruiters.com/BoschGroup/744000163798847", "other")).toBeNull()
  })
  test("look-alike and foreign hosts are rejected", () => {
    expect(parseJobRef("https://jobs.smartrecruiters.com.evil.com/BoschGroup/744000163798847")).toBeNull()
    expect(parseJobRef("https://jobs.smartrecruiters.com@evil.com/BoschGroup/744000163798847")).toBeNull()
    expect(parseJobRef("https://www.linkedin.com/jobs/view/1234567890")).toBeNull()
  })
})

describe("parseRemoteModes", () => {
  test("bare means remote, on-site normalises, comma is OR", () => {
    expect(parseRemoteModes(true)).toEqual({ value: "remote" })
    expect(parseRemoteModes("remote,on-site")).toEqual({ value: "remote,onsite" })
    expect(parseRemoteModes("HYBRID")).toEqual({ value: "hybrid" })
  })
  test("unknown and empty modes are rejected", () => {
    expect(parseRemoteModes("anywhere").bad).toBe("anywhere")
    expect(parseRemoteModes("").bad).toBe("")
    expect(parseRemoteModes("remote,,hybrid")).toEqual({ value: "remote,hybrid" })
  })
})

describe("locationLine", () => {  test("prefers fullLocation and appends Remote once", () => {
    expect(locationLine({ fullLocation: "Batu Kawan, Penang, Malaysia", remote: false })).toBe("Batu Kawan, Penang, Malaysia")
    expect(locationLine({ fullLocation: "Berlin, Germany", remote: true })).toBe("Berlin, Germany, Remote")
    expect(locationLine({ fullLocation: "Berlin, Germany", hybrid: true })).toBe("Berlin, Germany, Hybrid")
    expect(locationLine({ fullLocation: "Remote, Germany", remote: true })).toBe("Remote, Germany")
  })
  test("assembles from parts and expands a country code", () => {
    expect(locationLine({ city: "Austin", region: "Texas", country: "us" })).toBe("Austin, Texas, United States")
    expect(locationLine({ city: "New York", region: "New York", country: "us" })).toBe("New York, United States")
    expect(locationLine({ city: "", region: "Queensland", country: "au" })).toBe("Queensland, Australia")
    expect(locationLine({ country: "DE" })).toBe("Germany")
    expect(locationLine({ country: "ZZ" })).toBe("ZZ")
    expect(locationLine(null)).toBe("")
  })
})

describe("employmentLabel", () => {
  test("an internship level wins over a Full-time employment type", () => {
    expect(employmentLabel({ typeOfEmployment: { label: "Full-time" }, experienceLevel: { id: "internship", label: "Internship" } })).toBe("Internship")
    expect(employmentLabel({ typeOfEmployment: { label: "Contract" }, experienceLevel: { id: "entry_level" } })).toBe("Contract")
    expect(employmentLabel({})).toBeNull()
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
})

describe("jsonFetch backoff", () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })
  test("retries a 429, honoring Retry-After, then returns the body", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return calls === 1
        ? new Response("", { status: 429, headers: { "retry-after": "0" } })
        : new Response('{"ok":true}', { status: 200 })
    }) as unknown as typeof fetch
    expect(await jsonFetch<{ ok: boolean }>("https://api.smartrecruiters.com/v1/companies/acme/postings")).toEqual({ ok: true })
    expect(calls).toBe(2)
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
    expect(await jsonFetch<unknown[]>("https://api.smartrecruiters.com/v1/companies/acme/postings", { maxRetries: 3, baseDelayMs: 1 })).toEqual([])
    expect(calls).toBe(3)
  })
  test("404 returns null", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch
    expect(await jsonFetch("https://api.smartrecruiters.com/v1/companies/acme/postings/1")).toBeNull()
  })
})

describe("mapping", () => {
  const raw = {
    id: "744000163798847",
    name: "Senior Software Engineer",
    refNumber: "REF402",
    releasedDate: "2026-11-20T10:00:00.000Z",
    company: { identifier: "BoschGroup", name: "Bosch Group" },
    location: { fullLocation: "Berlin, Germany", remote: true },
    department: { label: "Engineering" },
    function: { label: "Engineering" },
    typeOfEmployment: { label: "Full-time" },
    experienceLevel: { id: "mid_senior_level", label: "Mid-Senior Level" },
    language: { code: "en" },
  }
  test("toCard maps every contract field", () => {
    const card = toCard(raw, "BoschGroup")
    expect(card).toMatchObject({
      id: "744000163798847",
      title: "Senior Software Engineer",
      company: "Bosch Group",
      location: "Berlin, Germany, Remote",
      date: "2026-11-20T10:00:00.000Z",
      board: "BoschGroup",
      department: "Engineering",
      function: "Engineering",
      employmentType: "Full-time",
      experienceLevel: "Mid-Senior Level",
      requisitionId: "REF402",
      language: "en",
    })
    expect(card.url).toBe("https://jobs.smartrecruiters.com/BoschGroup/744000163798847-senior-software-engineer")
  })
  test("toDetail trusts only a jobs.smartrecruiters.com postingUrl", () => {
    const detail = toDetail(
      {
        ...raw,
        postingUrl: "https://jobs.smartrecruiters.com/BoschGroup/744000163798847-senior-software-engineer",
        applyUrl: "https://jobs.smartrecruiters.com/BoschGroup/744000163798847-senior-software-engineer?oga=true",
        jobAd: { sections: { jobDescription: { text: "<p>Body</p>" }, qualifications: { text: "<ul><li>Req</li></ul>" } } },
      },
      "BoschGroup",
    )
    expect(detail.description).toBe("Body")
    expect(detail.qualifications).toBe("- Req")
    expect(detail.additionalInformation).toBeNull()
    expect(detail.companyDescription).toBeNull()
    expect(detail.active).toBe(true)
    expect(detail.applyUrl).toContain("?oga=true")

    const untrusted = toDetail({ ...raw, postingUrl: "https://evil.example/job" }, "BoschGroup")
    expect(untrusted.url).toBe("https://jobs.smartrecruiters.com/BoschGroup/744000163798847-senior-software-engineer")
  })
  test("toDetail maps deadline and structured compensation", () => {
    const d = toDetail(
      {
        ...raw,
        unpublishOn: "2026-12-15T00:00:00.000Z",
        compensation: { min: 100, max: 200, currency: "USD", period: "YEARLY" },
        jobAd: { sections: { jobDescription: { text: "<p>Body</p>" } } },
      },
      "BoschGroup",
    )
    expect(d.deadline).toBe("2026-12-15T00:00:00.000Z")
    expect(d.compensation).toEqual({ min: 100, max: 200, currency: "USD", period: "YEARLY" })
    const out = renderPlain(d)
    expect(out).toContain("Deadline: 2026-12-15")
    expect(out).toContain("Pay: 100–200 USD / yearly")
  })
  test("toDetail keeps only http(s) apply URLs", () => {
    for (const applyUrl of ["javascript:alert(1)", "data:text/html,hi", "/apply", "ftp://example.com/x"]) {
      expect(toDetail({ ...raw, applyUrl }, "BoschGroup").applyUrl).toBeNull()
    }
    expect(toDetail({ ...raw, applyUrl: "https://jobs.smartrecruiters.com/x?oga=true" }, "BoschGroup").applyUrl).toBe(
      "https://jobs.smartrecruiters.com/x?oga=true",
    )
  })
  test("plain output separates sections", () => {
    const out = renderPlain(
      toDetail(
        {
          ...raw,
          active: false,
          jobAd: {
            sections: {
              jobDescription: { text: "<p>Body</p>" },
              qualifications: { text: "<ul><li>Req</li></ul>" },
              companyDescription: { text: "<p>About us</p>" },
            },
          },
        },
        "BoschGroup",
      ),
    )
    expect(out).toContain("Body\n\nQualifications\n- Req")
    expect(out).toContain("\nCompany description\nAbout us")
    expect(out).toContain("Status: closed")
    expect(out).toContain("Posted: 2026-11-20")
  })
})

describe("filters and output helpers", () => {
  test("location matches case-insensitively", () => {
    expect(matchesLocation("Batu Kawan, Penang, Malaysia", "penang")).toBe(true)
    expect(matchesLocation(null, "penang")).toBe(false)
    expect(matchesLocation(null, undefined)).toBe(true)
  })
  test("a country name matches a posting that only had a country code", () => {
    expect(matchesLocation(locationLine({ city: "Berlin", country: "de" }), "germany")).toBe(true)
  })
  test("withinDays rejects old, undated and far-future postings", () => {
    const now = Date.parse("2026-11-20T12:00:00Z")
    expect(withinDays("2026-11-18T00:00:00Z", 7, now)).toBe(true)
    expect(withinDays("2026-10-01T00:00:00Z", 7, now)).toBe(false)
    expect(withinDays(null, 7, now)).toBe(false)
    expect(withinDays("2026-12-01T00:00:00Z", 7, now)).toBe(false)
    expect(withinDays("2026-11-20T12:30:00Z", 7, now)).toBe(true)
  })
  test("stripInvisible removes zero-width and tag characters", () => {
    expect(stripInvisible({ a: "Prod\u200Buct\u{E0041}" })).toEqual({ a: "Product" })
  })
  test("postingUrl omits an empty title slug", () => {
    expect(postingUrl("BoschGroup", "123")).toBe("https://jobs.smartrecruiters.com/BoschGroup/123")
  })
  test("table widens the ID column for long ids", () => {
    const card = {
      id: "ABCDEFGHIJKLMNOPQRST",
      title: "Engineer",
      company: "Acme",
      location: "Berlin, Germany",
      date: "2026-11-10",
      deadline: null,
      url: "https://jobs.smartrecruiters.com/acme/ABCDEFGHIJKLMNOPQRST-engineer",
      board: "acme",
      department: null,
      function: null,
      industry: null,
      employmentType: "Full-time",
      experienceLevel: null,
      requisitionId: null,
      language: null,
    }
    const [header, separator, row] = renderTable([card]).split("\n")
    expect(row.length).toBe(header.length)
    expect(separator.length).toBe(header.length)
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
