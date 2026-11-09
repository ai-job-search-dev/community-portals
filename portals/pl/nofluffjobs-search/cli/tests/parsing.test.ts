import { describe, expect, test } from "bun:test"
import {
  stripHtml,
  decodeEntities,
  isSafeSegment,
  innerText,
  textAfterDataCy,
  allTextAfterDataCy,
  parseAmount,
  parseSalaryText,
  splitCards,
  parseCard,
  parseCards,
  mainListing,
  parseJsonLdPosting,
  sectionText,
  parseAllSalaries,
  parseDeadline,
  mainRegion,
  filterByAge,
  listingDates,
  buildCriteria,
  citySlug,
  slugFromIdOrUrl,
  formatSalary,
  type JobCard,
} from "../src/helpers.js"
import { buildSearchUrl } from "../src/commands/search.js"

const CARD = `nfj-postings-item="" class="posting-list-item" id="nfjPostingListItem-senior-php-dev-acme-Warszawa" href="/job/senior-php-dev-acme-warszawa">
  <h3 data-cy="title position on the job offer listing"> Senior PHP Developer <span data-cy="sup"> NEW </span></h3>
  <nfj-posting-item-salary><span data-cy="salary ranges on the job offer listing"> 900 &ndash; 1&nbsp;100 PLN / day </span></nfj-posting-item-salary>
  <span data-cy="category name on the job offer listing"> Backend </span>
  <span data-cy="category name on the job offer listing"> Symfony </span>
  <h4 class="company-name tw-mb-0"><inline-icon><svg></svg></inline-icon> Acme Sp. z o.o. </h4>
  <nfj-posting-item-city data-cy="location on the job offer listing"><inline-icon><svg></svg></inline-icon> Warszawa &nbsp;+2 </nfj-posting-item-city>
</nfj-postings-item>`

describe("text extraction", () => {
  test("innerText skips a leading icon element", () => {
    expect(innerText(CARD, /<h4[^>]*class="company-name[^"]*"[^>]*>/i, "</h4>")).toBe("Acme Sp. z o.o.")
  })

  test("textAfterDataCy reads text that directly follows the tag", () => {
    expect(textAfterDataCy(CARD, "title position on the job offer listing")).toBe("Senior PHP Developer")
  })

  test("allTextAfterDataCy collects every match", () => {
    expect(allTextAfterDataCy(CARD, "category name on the job offer listing")).toEqual(["Backend", "Symfony"])
  })

  test("stripHtml makes bullets and decodes entities", () => {
    const out = stripHtml("<p>A&amp;B</p><ul><li>one</li><li>two</li></ul>")
    expect(out).toContain("A&B")
    expect(out).toContain("- one")
  })

  test("decodeEntities collapses non-breaking spaces", () => {
    expect(decodeEntities("1&nbsp;100")).toBe("1 100")
  })
})

describe("parseAmount", () => {
  test("reads spaced thousands", () => {
    expect(parseAmount("1 100")).toBe(1100)
    expect(parseAmount("18 000")).toBe(18000)
  })

  test("expands K/M abbreviations rather than truncating them", () => {
    expect(parseAmount("1.5M")).toBe(1_500_000)
    expect(parseAmount("2,5M")).toBe(2_500_000)
    expect(parseAmount("12K")).toBe(12_000)
  })

  test("treats a bare dot as a thousands separator", () => {
    expect(parseAmount("18.000")).toBe(18000)
  })

  test("returns null when there is no number", () => {
    expect(parseAmount("Undisclosed")).toBeNull()
  })
})

describe("parseSalaryText", () => {
  test("parses a listing-card band", () => {
    expect(parseSalaryText("900 – 1 100 PLN / day")).toEqual({
      type: null, from: 900, to: 1100, currency: "PLN", unit: "day",
    })
  })

  test("parses a detail-page band with contract type and 'per hour'", () => {
    expect(parseSalaryText("80 – 130 PLN + VAT (B2B) per hour")).toEqual({
      type: "b2b", from: 80, to: 130, currency: "PLN", unit: "hour",
    })
  })

  test("parses an abbreviated foreign-currency band", () => {
    expect(parseSalaryText("1.5M – 2.5M HUF / month")).toEqual({
      type: null, from: 1_500_000, to: 2_500_000, currency: "HUF", unit: "month",
    })
  })

  test("returns null when nothing is disclosed", () => {
    expect(parseSalaryText("Undisclosed salary")).toBeNull()
    expect(parseSalaryText(null)).toBeNull()
  })

  test("returns null for a hidden salary carrying a contract badge", () => {
    // parseCard appends the contract-type badge; the "2" in "B2B" is not a rate.
    expect(parseSalaryText("Sprawdzisz zarobki (B2B)")).toBeNull()
    expect(parseSalaryText("Zarobki na pierwszej rozmowie (B2B)")).toBeNull()
    expect(parseSalaryText("Check salary (B2B)")).toBeNull()
  })
})

describe("card parsing", () => {
  test("splitCards keeps only chunks holding an offer link", () => {
    expect(splitCards(CARD)).toHaveLength(1)
    expect(splitCards("<div>no cards here</div>")).toHaveLength(0)
  })

  test("parseCard maps the portal-skill contract fields", () => {
    const c = parseCard(CARD)!
    expect(c.id).toBe("senior-php-dev-acme-warszawa")
    expect(c.title).toBe("Senior PHP Developer")
    expect(c.company).toBe("Acme Sp. z o.o.")
    expect(c.location).toBe("Warszawa")
    expect(c.url).toBe("https://nofluffjobs.com/job/senior-php-dev-acme-warszawa")
    expect(c.tags).toEqual(["Backend", "Symfony"])
  })

  test("the '+N' suffix becomes a count, not part of the city name", () => {
    expect(parseCard(CARD)!.extraLocations).toBe(2)
  })

  test("date is null on cards - listings carry no publication date", () => {
    expect(parseCard(CARD)!.date).toBeNull()
  })

  test("parseCards de-duplicates repeated offers", () => {
    expect(parseCards(CARD + CARD)).toHaveLength(1)
  })

  test("mainListing drops the 'Mogą Cię też zainteresować' filler list", () => {
    // Below the real matches the portal appends offers that do NOT match the
    // query (listname="search_extended"); they must never be returned as results.
    const filler = CARD.replaceAll("senior-php-dev-acme", "kotlin-dev-other")
    const page =
      `<nfj-postings-list data-cy="nfjPostingsList" listname="search">${CARD}</nfj-postings-list>` +
      `<nfj-postings-list data-cy="nfjPostingsList" listname="search_extended">` +
      `<h2> Mogą Cię też zainteresować </h2>${filler}</nfj-postings-list>`
    const ids = parseCards(mainListing(page)).map((c) => c.id)
    expect(ids).toEqual(["senior-php-dev-acme-warszawa"])
  })

  test("mainListing leaves a page without a filler list unchanged", () => {
    expect(mainListing(CARD)).toBe(CARD)
  })

  test("company from the plain-span markup has HTML entities decoded", () => {
    const flat = `nfj-postings-item href="/job/backend-dev-cf-remote">
  <h3 data-cy="title position on the job offer listing"> Backend Developer </h3>
  <inline-icon commonicon="job_offer"><svg></svg></inline-icon><span class="tw-truncate">C&amp;F S.A.</span>
</nfj-postings-item>`
    expect(parseCard(flat)!.company).toBe("C&F S.A.")
  })

  test("a card with no title is skipped, not returned half-empty", () => {
    expect(parseCard('nfj-postings-item href="/job/x"')).toBeNull()
  })
})

describe("detail parsing", () => {
  const DETAIL = `<html><script type="application/ld+json">{"@graph":[
      {"@type":"Organization","name":"Acme"},
      {"@type":"JobPosting","title":"Senior PHP Developer","datePosted":"2026-08-07","employmentType":"CONTRACTOR","hiringOrganization":{"name":"Acme"}}
    ]}</script>
    <div id="posting-header">Offer valid until: 06.09.2026 (7 days left)
      <common-posting-salaries-list> 80 &ndash; 130 PLN + VAT (B2B) per hour </common-posting-salaries-list>
    </div>
    <div id="posting-requirements"> Must have <ul><li>PHP</li><li>English (C1)</li></ul></div>
    <div id="posting-tasks"> Your responsibilities <ul><li>Ship things</li></ul></div>
    <nfj-posting-similar>
      <nfj-posting-item-salary> 19 000 &ndash; 26 000 PLN / month </nfj-posting-item-salary>
    </nfj-posting-similar></html>`

  test("parseJsonLdPosting finds JobPosting inside a @graph", () => {
    expect(parseJsonLdPosting(DETAIL)!.datePosted).toBe("2026-08-07")
  })

  test("mainRegion excludes the similar-offers list", () => {
    const region = mainRegion(DETAIL)
    expect(region).toContain("posting-requirements")
    expect(region).not.toContain("19 000")
  })

  test("salary comes from the posting, never from similar offers", () => {
    const bands = parseAllSalaries(DETAIL)
    expect(bands).toHaveLength(1)
    expect(bands[0]).toEqual({ type: "b2b", from: 80, to: 130, currency: "PLN", unit: "hour" })
  })

  test("sectionText returns clean text without leaking attributes", () => {
    const req = sectionText(DETAIL, "posting-requirements")!
    expect(req).toContain("Must have")
    expect(req).toContain("- PHP")
    expect(req).toContain("English (C1)")
    expect(req).not.toContain("id=")
    expect(req).not.toContain("Your responsibilities")
  })

  test("parseDeadline reads the offer's validity date", () => {
    expect(parseDeadline(DETAIL)).toBe("2026-09-06")
  })
})

describe("filters and urls", () => {
  const mk = (date: string | null): JobCard =>
    ({ id: "x", title: "t", company: null, location: null, date, url: "u",
       salary: null, tags: [], extraLocations: 0 })

  test("filterByAge drops stale postings and keeps undated ones", () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10)
    expect(filterByAge([mk(old)], 14)).toHaveLength(0)
    expect(filterByAge([mk(null)], 14)).toHaveLength(1)
  })

  test("filterByAge keeps a posting dated on the cutoff's own day", () => {
    // `date` is day-granular: under --jobage 1, yesterday's posting may be only
    // hours old. Comparing its midnight against now-24h used to drop it.
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
    expect(filterByAge([mk(yesterday)], 1)).toHaveLength(1)
    expect(filterByAge([mk(twoDaysAgo)], 1)).toHaveLength(0)
  })

  test("listingDates reads posting dates and the match count from the page state", () => {
    const state = {
      "8ccf9590": {
        totalCount: 2,
        postings: [
          { url: "php-dev-acme-remote", title: "PHP Dev", posted: Date.parse("2026-11-03T12:03:00Z"), renewed: Date.parse("2026-11-04T08:00:00Z") },
          { url: "senior-php-beta-remote", title: "Senior PHP", posted: Date.parse("2026-10-12T10:52:00Z") },
        ],
        additionalSearch: [{ totalCount: 99, postings: [{ url: "kotlin-filler", title: "Kotlin", posted: 1 }] }],
      },
    }
    const html = `<html><script id="serverApp-state" type="application/json">${JSON.stringify(state)}</script></html>`
    const { dates, total } = listingDates(html)
    // The original publication date, not the renewal ("bump") date.
    expect(dates.get("php-dev-acme-remote")).toBe("2026-11-03")
    expect(dates.get("senior-php-beta-remote")).toBe("2026-10-12")
    expect(dates.has("kotlin-filler")).toBe(false)
    expect(total).toBe(2)
  })

  test("listingDates returns nothing, not an error, when the state block is missing or broken", () => {
    expect(listingDates("<html></html>")).toEqual({ dates: new Map(), total: null })
    expect(listingDates('<script id="serverApp-state" type="application/json">{oops</script>').total).toBeNull()
  })

  test("buildSearchUrl with all requests the 10-page cumulative view in one go", () => {
    const url = buildSearchUrl({ query: "php", page: 1, all: true, dates: false, format: "json" })
    expect(new URL(url).searchParams.get("page")).toBe("10")
  })

  test("buildCriteria packs filters into one string", () => {
    expect(buildCriteria({ keyword: "php", city: "remote", seniority: undefined }))
      .toBe("keyword=php city=remote")
    expect(buildCriteria({ keyword: undefined })).toBeNull()
  })

  test("citySlug normalizes cities and remote synonyms", () => {
    expect(citySlug("Remote")).toBe("remote")
    expect(citySlug("zdalnie")).toBe("remote")
    expect(citySlug("Kraków")).toBe("krakow")
    expect(citySlug("Wrocław, Poland")).toBe("wroclaw")
    expect(citySlug(undefined)).toBeUndefined()
  })

  test("slugFromIdOrUrl accepts a slug or a full URL", () => {
    expect(slugFromIdOrUrl("abc")).toBe("abc")
    expect(slugFromIdOrUrl("https://nofluffjobs.com/job/abc")).toBe("abc")
  })

  test("buildSearchUrl maps flags onto the criteria string", () => {
    const url = buildSearchUrl({
      query: "PHP Symfony", location: "Remote", category: "backend",
      seniority: "senior", page: 2, dates: false, format: "json",
    })
    expect(url).toContain("criteria=")
    expect(decodeURIComponent(url)).toContain("keyword=PHP Symfony")
    expect(decodeURIComponent(url)).toContain("city=remote")
    expect(decodeURIComponent(url)).toContain("seniority=senior")
    expect(url).toContain("page=2")
  })

  test("buildSearchUrl omits page 1 and unset filters", () => {
    const url = buildSearchUrl({ page: 1, dates: false, format: "json" })
    expect(url).not.toContain("page=")
    expect(url).not.toContain("criteria=")
  })

  test("buildSearchUrl always requests newest-first ordering", () => {
    // Without sort=newest the portal orders by relevance, so a fresh posting can
    // sit below the limit cut-off and never be returned.
    const bare = buildSearchUrl({ page: 1, dates: false, format: "json" })
    expect(bare).toBe("https://nofluffjobs.com/pl?sort=newest")
    const full = buildSearchUrl({ query: "php", location: "Remote", page: 3, dates: false, format: "json" })
    expect(new URL(full).searchParams.get("sort")).toBe("newest")
    expect(new URL(full).searchParams.get("page")).toBe("3")
  })

  test("formatSalary renders a band or a dash", () => {
    expect(formatSalary({ type: "b2b", from: 80, to: 130, currency: "PLN", unit: "hour" })).toBe("80-130 PLN/hour")
    expect(formatSalary(null)).toBe("-")
  })
})

describe("decodeEntities hardening", () => {
  test("is single-pass: &amp;lt; yields the text &lt;, not <", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;")
    expect(decodeEntities("&amp;amp;")).toBe("&amp;")
  })

  test("still decodes the common entities and the dash entities", () => {
    expect(decodeEntities("a&nbsp;b &amp; &lt;c&gt; &quot;d&quot; &ndash; &mdash; &#x41; &#65;")).toBe(
      'a b & <c> "d" \u2013 \u2014 A A',
    )
  })

  test("an invalid numeric entity is left as written, never thrown", () => {
    for (const bad of ["&#1114112;", "&#x110000;", "&#99999999999;", "&#0;", "&#xD800;"]) {
      expect(decodeEntities(`x ${bad} y`)).toBe(`x ${bad} y`)
    }
  })
})

describe("isSafeSegment", () => {
  test("accepts offer slugs", () => {
    for (const s of ["php", "mid-senior-symfony-developer-polcode-remote", "data_science"]) {
      expect(isSafeSegment(s)).toBe(true)
    }
  })

  test("rejects anything that could leave the path segment", () => {
    for (const s of ["", "..", "../api", "a/b", "a?b", "a#b", "%2e%2e", "-x", ".hidden", "a b"]) {
      expect(isSafeSegment(s)).toBe(false)
    }
  })
})
