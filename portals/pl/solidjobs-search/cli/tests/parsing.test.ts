import { describe, expect, test } from "bun:test"
import { codeFromUrl, htmlToText, parseApiPage, parseJob, parseJobDetail, withinDays } from "../src/helpers.ts"
import { normalizeId } from "../src/commands/detail.ts"
import { buildUrl } from "../src/commands/search.ts"

const apiJob = {
  jobOfferKey: "00000000-0000-0000-0000-000000000001",
  title: "Senior PHP Developer &amp; Architect",
  company: "Example Sp. z o.o.",
  category: "Developer",
  subCategory: "PHP",
  salary: { from: 20000, to: 26000, currency: "PLN", period: "Month", employmentType: "B2B" },
  secondarySalary: null,
  locations: ["Gdańsk", "Szczecin"],
  isRemote: false,
  isHybrid: true,
  url: "https://solid.jobs/o/abc123xy/ai-job-search-cli",
  experienceLevel: "Senior",
  skills: [{ name: "PHP", level: "Expert" }, { name: "Symfony", level: "Advanced" }],
  languages: [{ name: "Angielski", level: "Advanced" }],
  validFrom: "2026-10-20T10:00:00.0000000+02:00",
  validTo: "2026-11-20T10:00:00.0000000+01:00",
}

describe("parseJob", () => {
  test("maps the API job onto the portal contract", () => {
    const j = parseJob(apiJob)!
    expect(j.id).toBe("abc123xy")
    expect(j.title).toBe("Senior PHP Developer & Architect")
    expect(j.company).toBe("Example Sp. z o.o.")
    expect(j.location).toBe("Gdańsk, Szczecin")
    expect(j.date).toBe("2026-10-20")
    expect(j.deadline).toBe("2026-11-20")
    expect(j.url).toBe("https://solid.jobs/o/abc123xy")
    expect(j.workplaceType).toBe("hybrid")
    expect(j.salary).toEqual({ from: 20000, to: 26000, currency: "PLN", period: "Month", employmentType: "B2B" })
    expect(j.secondarySalary).toBeNull()
    expect(j.skills).toEqual(["PHP", "Symfony"])
    expect(j.languages).toEqual(["Angielski (Advanced)"])
  })

  test("missing values become null, never omitted", () => {
    const j = parseJob({ title: "X", url: "https://solid.jobs/o/zz99zz99", isRemote: true })!
    expect(j.company).toBeNull()
    expect(j.date).toBeNull()
    expect(j.salary).toBeNull()
    expect(j.location).toBe("Remote")
    expect(Object.keys(j)).toContain("deadline")
  })

  test("one malformed job is skipped, not fatal", () => {
    const body = JSON.stringify({
      pageIndex: 0, pageSize: 3, totalCount: 3, totalPages: 1,
      jobs: [apiJob, null, { title: "no url" }, { url: "https://evil.io/o/abc" }],
    })
    const { results, page } = parseApiPage(body)
    expect(results).toHaveLength(1)
    expect(page.totalCount).toBe(3)
  })

  test("non-JSON body throws a clear error", () => {
    expect(() => parseApiPage("<html>")).toThrow(/non-JSON/)
  })
})

describe("codeFromUrl / normalizeId", () => {
  test("short codes come only from solid.jobs", () => {
    expect(codeFromUrl("https://solid.jobs/o/abc123xy/campaign")).toBe("abc123xy")
    expect(codeFromUrl("https://solid.jobs.evil.io/o/abc123xy")).toBeNull()
  })

  test("accepts codes, short links and full offer URLs", () => {
    expect(normalizeId("abc123xy")).toEqual({ id: "abc123xy", path: "/o/abc123xy" })
    expect(normalizeId("https://solid.jobs/o/abc123xy/ai-job-search-cli")).toEqual({ id: "abc123xy", path: "/o/abc123xy" })
    expect(normalizeId("solid.jobs/offer/39620/scalo-devops-engineer")).toEqual({
      id: "39620",
      path: "/offer/39620/scalo-devops-engineer",
    })
  })

  test("rejects other hosts, look-alikes and userinfo tricks", () => {
    expect(normalizeId("https://evil.io/o/abc123xy")).toBeNull()
    expect(normalizeId("https://solid.jobs.evil.io/o/abc123xy")).toBeNull()
    expect(normalizeId("https://solid.jobs@evil.io/o/abc123xy")).toBeNull()
    expect(normalizeId("https://user@solid.jobs/o/abc123xy")).toBeNull()
  })
})

describe("buildUrl", () => {
  test("maps flags to documented API parameters", () => {
    const url = new URL(
      buildUrl({ division: "IT", query: "php", location: "Gdańsk", experience: ["Senior"], minSalary: 20000, page: 2, format: "json" }),
    )
    expect(url.pathname).toBe("/public-api/offers/IT")
    expect(url.searchParams.get("campaign")).toBe("ai-job-search-cli")
    expect(url.searchParams.get("search.searchTerm")).toBe("php")
    expect(url.searchParams.get("search.cities")).toBe("Gdańsk")
    expect(url.searchParams.get("search.experiences")).toBe("Senior")
    expect(url.searchParams.get("search.minimumSalary")).toBe("20000")
    expect(url.searchParams.get("pageIndex")).toBe("1")
    expect(url.searchParams.get("sortActive")).toBe("validFrom")
    expect(url.searchParams.get("sortDirection")).toBe("desc")
  })
})

describe("withinDays", () => {
  const now = Date.parse("2026-11-02T12:00:00Z")
  test("filters by publication date and keeps undated jobs", () => {
    expect(withinDays({ date: "2026-10-30" }, 7, now)).toBe(true)
    expect(withinDays({ date: "2026-10-01" }, 7, now)).toBe(false)
    expect(withinDays({ date: null }, 7, now)).toBe(true)
  })

  test("a date-only offer from the cutoff's calendar day is kept, never dropped", () => {
    // --jobage 1 at 12:00 on 11-02: the cutoff falls on 11-01, so an offer dated
    // 11-01 may be only 12h old. Comparing its midnight against now-24h dropped it.
    expect(withinDays({ date: "2026-11-01" }, 1, now)).toBe(true)
    expect(withinDays({ date: "2026-10-31" }, 1, now)).toBe(false)
  })
})

const detailHtml = (validThrough: string, expired = false) => `<html><head>
<script type="application/ld+json">{"@type":"WebSite","name":"SOLID.Jobs"}</script>
<script type="application/ld+json">{ broken json </script>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Backend Engineer",
  description: "<p><strong>Zakres</strong></p><ul><li>API &amp; integracje</li><li>Płatności</li></ul><p>Zdalnie&nbsp;100%</p>",
  hiringOrganization: { "@type": "Organization", name: "Example" },
  datePosted: "2026-10-20",
  validThrough,
  employmentType: "CONTRACTOR",
  jobLocation: { "@type": "Place", address: { addressLocality: "Szczecin", addressCountry: "PL" } },
  jobLocationType: "TELECOMMUTE",
  baseSalary: { currency: "PLN", value: { minValue: 150, maxValue: 180, unitText: "HOUR" } },
  experienceRequirements: { monthsOfExperience: 60 },
  skills: "PHP, MySQL",
})}</script>
<script id="ng-state" type="application/json">{"x":{"b":{"isFound":true,"isExpired":${expired}}}}</script>
</head></html>`

describe("parseJobDetail", () => {
  const now = Date.parse("2026-11-02T12:00:00Z")

  test("reads the JobPosting JSON-LD and skips malformed blocks", () => {
    const d = parseJobDetail(detailHtml("2026-12-01T10:00:00+01:00"), "abc123xy", "https://solid.jobs/o/abc123xy", now)!
    expect(d.title).toBe("Backend Engineer")
    expect(d.company).toBe("Example")
    expect(d.location).toBe("Szczecin")
    expect(d.remote).toBe(true)
    expect(d.salary).toEqual({ from: 150, to: 180, currency: "PLN", period: "Hour", employmentType: "CONTRACTOR" })
    expect(d.deadline).toBe("2026-12-01")
    expect(d.experienceMonths).toBe(60)
    expect(d.skills).toEqual(["PHP", "MySQL"])
    expect(d.description).toBe("Zakres\n- API & integracje\n- Płatności\n\nZdalnie 100%")
    expect(d.isActive).toBe(true)
  })

  test("expired flag or past deadline marks the offer closed", () => {
    expect(parseJobDetail(detailHtml("2026-12-01", true), "a", "u", now)!.isActive).toBe(false)
    expect(parseJobDetail(detailHtml("2026-10-01"), "a", "u", now)!.isActive).toBe(false)
  })

  test("a page without JobPosting returns null", () => {
    expect(parseJobDetail("<html></html>", "a", "u", now)).toBeNull()
  })
})

describe("htmlToText", () => {
  test("decodes entities once (no double-decoding)", () => {
    expect(htmlToText("<p>&amp;lt;tag&amp;gt;</p>")).toBe("&lt;tag&gt;")
  })
})
