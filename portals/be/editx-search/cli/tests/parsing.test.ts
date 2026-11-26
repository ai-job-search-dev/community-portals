import { describe, expect, test } from "bun:test"
import { join } from "path"
import { cleanHtml, contractDate, decodeHtmlEntities, normalizeId, postingUrl, toDetail, toResult } from "../src/helpers"
import { buildQuery, withinDays } from "../src/commands/search"

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", name)).json()

describe("toResult", () => {
  test("maps every job in the saved search response to the contract fields", async () => {
    const body = await fixture("search-leuven-python.json")
    const rows = body.jobs.map(toResult)
    expect(rows.map((r: { id: string }) => r.id)).toEqual(["20750", "17038", "17704"])
    expect(rows[0]).toEqual({
      id: "20750",
      title: "Python Developer | Financial Sector",
      company: "Sander",
      location: expect.stringContaining("Flemish Brabant"),
      date: "2026-11-17",
      url: "https://editx.eu/en/it-jobs/20750/python-developer-financial-sector",
      remote: ">50% remote",
      contract: "permanent",
      skills: ["Python"],
    })
  })

  test("missing values are null, never omitted", () => {
    const r = toResult({ id: 7 })
    expect(r).toEqual({ id: "7", title: "(untitled)", company: null, location: null, date: null, url: "https://editx.eu/en/it-jobs/7", remote: null, contract: null, skills: [] })
  })

  test("dedupes a locality repeated as an area", () => {
    expect(toResult({ id: 1, locality: "Leuven", areas: [{ label: "Leuven" }, { label: "Flemish Brabant" }] }).location).toBe("Leuven, Flemish Brabant")
  })

  test("never carries the recruiter object", () => {
    const job = { id: 1, title: "x", recruiter: { firstname: "Jane", lastname: "D.", linkedin: "https://www.linkedin.com/in/jane" } }
    expect(JSON.stringify(toResult(job as never))).not.toMatch(/Jane|linkedin|recruiter/i)
  })
})

describe("toDetail", () => {
  test("saved detail response", async () => {
    const d = toDetail(await fixture("detail-20750.json"))
    expect(d.experience).toEqual(["5 - 10 years"])
    expect(d.education).toEqual(["bachelor degree", "master degree"])
    expect(d.functions).toEqual(["Developer / Programmer"])
    expect(d.summary).toContain("python")
    expect(d.description).toContain("Python Developer")
  })

  test("tracking parameters are removed from the apply link, others kept", () => {
    const d = toDetail({ id: 1, applicationType: "url", applicationAction: "https://jobs.example/apply/9?ref=x&utm_source=editx&utm_medium=web&gclid=abc" })
    expect(d.apply_url).toBe("https://jobs.example/apply/9?ref=x")
    expect(toDetail({ id: 1, applicationType: "url", applicationAction: "https://jobs.example/a?utm_source=editx" }).apply_url).toBe("https://jobs.example/a")
  })

  test("summary is cleaned like the other text sections", () => {
    expect(toDetail({ id: 1, shortDescription: "<b>Hi</b> &eacute;quipe" }).summary).toBe("Hi \u00E9quipe")
  })

  test("non-url application types yield no apply link", () => {
    expect(toDetail({ id: 1, applicationType: "email", applicationAction: "jobs@example.com" }).apply_url).toBeNull()
    expect(toDetail({ id: 1, applicationType: "url", applicationAction: "javascript:alert(1)" }).apply_url).toBeNull()
  })
})

describe("small helpers", () => {
  test("contractDate", () => {
    expect(contractDate("2026-11-17 08:10:22")).toBe("2026-11-17")
    expect(contractDate("17/11/2026")).toBeNull()
    expect(contractDate(undefined)).toBeNull()
  })

  test("postingUrl slug", () => {
    expect(postingUrl("5", "Développeur Full-Stack (H/F)")).toBe("https://editx.eu/en/it-jobs/5/developpeur-full-stack-h-f")
  })

  test("entities decode once, after tags are stripped", () => {
    expect(decodeHtmlEntities("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;")
    expect(cleanHtml("<p>A &lt;b&gt; tag</p>")).toBe("A <b> tag")
    expect(cleanHtml("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two")
    expect(cleanHtml("")).toBeNull()
    expect(cleanHtml("<p>salary < 5000 and 'senior' > junior</p>")).toBe("salary < 5000 and 'senior' > junior")
    expect(decodeHtmlEntities("d&eacute;veloppeur &agrave; Li&egrave;ge &ndash; 5&euro; &Eacute;t&eacute; &rsquo;")).toBe(
      "d\u00E9veloppeur \u00E0 Li\u00E8ge \u2013 5\u20AC \u00C9t\u00E9 \u2019",
    )
    expect(decodeHtmlEntities("&unknownthing;")).toBe("&unknownthing;")
    // Punctuation names are case-sensitive: &Colon; is U+2237, so it must not become ":".
    expect(decodeHtmlEntities("a&colon;b &Colon; &COLON; &AMP;")).toBe("a:b &Colon; &COLON; &")
    for (const inherited of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(decodeHtmlEntities(`&${inherited};`)).toBe(`&${inherited};`)
    }
  })

  test("normalizeId accepts ids and editx.eu posting URLs only", () => {
    expect(normalizeId("20750")).toBe("20750")
    expect(normalizeId(" https://editx.eu/en/it-jobs/20750/python-developer ")).toBe("20750")
    expect(normalizeId("https://www.editx.eu/nl/it-jobs/20750")).toBe("20750")
    expect(normalizeId("editx.eu/fr/it-jobs/20750/")).toBe("20750")
    expect(normalizeId("https://editx.eu/en/job/20750")).toBe("20750")
    expect(normalizeId("https://editx.eu.evil.example/en/it-jobs/20750")).toBeNull()
    expect(normalizeId("https://api.editx.eu/api/editx/job/20750")).toBeNull()
  })

  test("buildQuery always asks for a full page of 50 and maps pages to 0-based", () => {
    expect(Object.fromEntries(buildQuery({ query: "data engineer", location: "Gent", page: 2, limit: 500, format: "json" }))).toEqual({
      keyword: "data engineer",
      location: "Gent",
      page: "1",
      count: "50",
    })
    expect(buildQuery({ query: "x", page: 1, limit: 5, format: "json" }).get("count")).toBe("50")
  })

  test("withinDays", () => {
    const today = new Date("2026-11-25T15:00:00Z")
    expect(withinDays("2026-11-17", 14, today)).toBe(true)
    expect(withinDays("2026-11-10", 14, today)).toBe(false)
    expect(withinDays(null, 14, today)).toBe(false)
    expect(withinDays("2026-11-25", 1, today)).toBe(true) // today counts as day 1
    expect(withinDays("2026-11-24", 1, today)).toBe(false)
    expect(withinDays("2026-11-26", 14, today)).toBe(false) // future dates stay out
  })
})
