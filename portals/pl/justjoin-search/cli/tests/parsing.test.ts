import { describe, expect, test } from "bun:test"
import {
  extractRscPayload,
  matchBraces,
  parseOffers,
  parseDetailOffer,
  normalizeOffer,
  labelValue,
  skillNames,
  resolveRscRef,
  locationSlug,
  slugFromIdOrUrl,
  filterByAge,
  stripHtml,
  formatSalary,
  type JobCard,
} from "../src/helpers.js"
import { buildSearchUrl } from "../src/commands/search.js"

const OFFER = {
  applyUrl: null,
  body: "$5b",
  city: "Opole",
  companyName: "BitBag",
  employmentTypes: [
    { from: 8000, to: 12000, currency: "PLN", currencySource: "original", type: "b2b", unit: "month", gross: false },
    { from: 1859, to: 2788, currency: "EUR", currencySource: "conversion", type: "b2b", unit: "month", gross: false },
  ],
  experienceLevel: "mid",
  publishedAt: "2026-08-28T07:00:32.68Z",
  expiredAt: "2026-09-12T06:58:59.02Z",
  requiredSkills: ["Symfony", "PHP"],
  slug: "bitbag-mid-symfony-developer-opole-php",
  title: "Mid Symfony Developer",
  workplaceType: "remote",
  multilocation: [
    { slug: "bitbag-mid-symfony-developer-opole-php", city: "Opole" },
    { slug: "bitbag-mid-symfony-developer-wroclaw-php", city: "Wrocław" },
  ],
}

function rscHtml(...payloads: string[]): string {
  return payloads
    .map((p) => `<script>self.__next_f.push([1,${JSON.stringify(p)}])</script>`)
    .join("")
}

describe("extractRscPayload", () => {
  test("concatenates streamed chunks in order", () => {
    expect(extractRscPayload(rscHtml('{"a":', '1}'))).toBe('{"a":1}')
  })

  test("skips a malformed chunk instead of losing the page", () => {
    const html = `<script>self.__next_f.push([1,"good"])</script><script>self.__next_f.push([1,"unterminated])</script><script>self.__next_f.push([1,"tail"])</script>`
    expect(extractRscPayload(html)).toContain("good")
  })

  test("returns empty string when the page has no payload", () => {
    expect(extractRscPayload("<html><body>nope</body></html>")).toBe("")
  })
})

describe("matchBraces", () => {
  test("ignores braces inside string literals", () => {
    const s = '{"a":"}{","b":{"c":1}}'
    expect(matchBraces(s, 0)).toBe(s.length - 1)
  })

  test("ignores escaped quotes", () => {
    const s = '{"a":"say \\"}\\" now"}'
    expect(matchBraces(s, 0)).toBe(s.length - 1)
  })

  test("returns -1 on a truncated object", () => {
    expect(matchBraces('{"a":1', 0)).toBe(-1)
  })
})

describe("parseOffers", () => {
  test("extracts every offer and dedupes by slug", () => {
    const payload = `junk${JSON.stringify(OFFER)}more${JSON.stringify(OFFER)}`
    expect(parseOffers(payload)).toHaveLength(1)
  })

  test("a malformed offer does not cost the others", () => {
    const payload = `{"applyUrl":BROKEN}${JSON.stringify(OFFER)}`
    const offers = parseOffers(payload)
    expect(offers).toHaveLength(1)
    expect(offers[0]!.slug).toBe(OFFER.slug)
  })
})

describe("normalizeOffer", () => {
  const card = normalizeOffer(OFFER as unknown as Record<string, unknown>)!

  test("maps the portal-skill contract fields", () => {
    expect(card.id).toBe(OFFER.slug)
    expect(card.title).toBe("Mid Symfony Developer")
    expect(card.company).toBe("BitBag")
    expect(card.location).toBe("Opole")
    expect(card.date).toBe("2026-08-28")
    expect(card.url).toBe(`https://justjoin.it/job-offer/${OFFER.slug}`)
  })

  test("prefers the employer's own currency over converted bands", () => {
    expect(card.salary).toEqual({
      type: "b2b", from: 8000, to: 12000, currency: "PLN", unit: "month", gross: false,
    })
  })

  test("carries deadline, skills and sibling cities", () => {
    expect(card.deadline).toBe("2026-09-12")
    expect(card.skills).toEqual(["Symfony", "PHP"])
    expect(card.otherLocations).toEqual(["Wrocław"])
  })

  test("returns null for an offer with no slug or title", () => {
    expect(normalizeOffer({ applyUrl: null } as Record<string, unknown>)).toBeNull()
  })
})

describe("detail-page shapes", () => {
  test("labelValue accepts plain strings and {label,value} objects", () => {
    expect(labelValue("remote")).toBe("remote")
    expect(labelValue({ label: "senior", value: "senior" })).toBe("senior")
    expect(labelValue(null)).toBeNull()
  })

  test("skillNames accepts string and object skill lists", () => {
    expect(skillNames(["PHP"])).toEqual(["PHP"])
    expect(skillNames([{ id: "PHP", name: "PHP", level: 4 }])).toEqual(["PHP"])
    expect(skillNames(undefined)).toEqual([])
  })

  test("parseDetailOffer unwraps the {\"offer\":{...}} envelope", () => {
    const payload = `x:[{"offer":${JSON.stringify(OFFER)}}]`
    expect(parseDetailOffer(payload)!.slug).toBe(OFFER.slug)
  })

  test("resolveRscRef reads a streamed text chunk by hex length", () => {
    const body = "<p>Hi</p>"
    const payload = `\n5b:T${body.length.toString(16)},${body}trailing junk`
    expect(resolveRscRef(payload, "$5b")).toBe(body)
  })

  test("resolveRscRef returns null for a non-reference body", () => {
    expect(resolveRscRef("", "literal text")).toBeNull()
  })
})

describe("stripHtml", () => {
  test("turns list items into bullets and decodes entities", () => {
    const out = stripHtml("<p>A&amp;B</p><ul><li>one</li><li>two</li></ul>")
    expect(out).toContain("A&B")
    expect(out).toContain("- one")
    expect(out).toContain("- two")
  })
})

describe("filterByAge", () => {
  const mk = (date: string | null): JobCard =>
    ({ id: "x", title: "t", company: null, location: null, date, url: "u",
       workplaceType: null, experienceLevel: null, employmentType: null,
       salary: null, deadline: null, skills: [], otherLocations: [] })

  test("drops offers older than the window", () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10)
    const fresh = new Date().toISOString().slice(0, 10)
    const kept = filterByAge([mk(old), mk(fresh)], 14)
    expect(kept.map((c) => c.date)).toEqual([fresh])
  })

  test("keeps undated offers rather than silently hiding them", () => {
    expect(filterByAge([mk(null)], 14)).toHaveLength(1)
  })

  test("keeps an offer dated on the cutoff's own day", () => {
    // `date` is day-granular: under --jobage 1, yesterday's offer may be only
    // hours old. Comparing its midnight against now-24h used to drop it.
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
    expect(filterByAge([mk(yesterday)], 1)).toHaveLength(1)
    expect(filterByAge([mk(twoDaysAgo)], 1)).toHaveLength(0)
  })
})

describe("url building", () => {
  test("locationSlug normalizes Polish city names", () => {
    expect(locationSlug(undefined)).toBe("all-locations")
    expect(locationSlug("Poland")).toBe("all-locations")
    expect(locationSlug("Warszawa")).toBe("warszawa")
    expect(locationSlug("Kraków, Poland")).toBe("krakow")
    expect(locationSlug("Wrocław")).toBe("wroclaw")
    expect(locationSlug("Zielona Góra")).toBe("zielona-gora")
  })

  test("slugFromIdOrUrl accepts a slug or a full offer URL", () => {
    expect(slugFromIdOrUrl("abc-php")).toBe("abc-php")
    expect(slugFromIdOrUrl("https://justjoin.it/job-offer/abc-php")).toBe("abc-php")
  })

  test("buildSearchUrl maps flags onto the portal's parameters", () => {
    const url = buildSearchUrl({
      query: "PHP Symfony", location: "Warszawa", category: "php",
      workplace: "remote", experience: "senior", employmentType: "b2b",
      withSalary: true, jobage: 14, format: "json",
    })
    expect(url).toContain("/job-offers/warszawa/php")
    expect(url).toContain("keyword=PHP+Symfony")
    expect(url).toContain("workplace=remote")
    expect(url).toContain("experience-level=senior")
    expect(url).toContain("employment-type=b2b")
    expect(url).toContain("with-salary=yes")
    expect(url).toContain("sortBy=published")
  })

  test("buildSearchUrl omits filters that were not set", () => {
    const url = buildSearchUrl({ jobage: 9999, format: "json" })
    expect(url).toContain("/job-offers/all-locations")
    expect(url).not.toContain("keyword=")
    expect(url).not.toContain("workplace=")
  })
})

describe("formatSalary", () => {
  test("renders a band with its contract type", () => {
    expect(formatSalary({ type: "b2b", from: 125, to: 145, currency: "PLN", unit: "hour", gross: false }))
      .toBe("125-145 PLN/hour (b2b)")
  })

  test("renders a dash when the offer discloses nothing", () => {
    expect(formatSalary(null)).toBe("-")
  })
})
