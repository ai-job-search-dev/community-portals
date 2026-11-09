import { describe, expect, test } from "bun:test"
import {
  visibleHtml,
  buildListUrl,
  htmlToText,
  normalizeCity,
  parseDetail,
  parseSearch,
  stripInvisible,
} from "../src/helpers.js"
import { jobageCutoff, matchesTerms, resolveQuery, sortNewestFirst } from "../src/commands/search.js"
import { normalizeId } from "../src/commands/detail.js"

const page = (pageProps: unknown) =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } }).replace(/</g, "\\u003c")}</script></body></html>`

const job = (over: Record<string, unknown> = {}) => ({
  id: "1001-php-developer-gdansk-acme",
  position: "PHP Developer",
  company: { name: "Acme" },
  city: "Gdańsk",
  remote: false,
  experienceLevel: "senior",
  employmentType: "full_time",
  contractB2b: true,
  contractEmployment: false,
  showSalary: true,
  denominatedSalaryLong: { money: "20 000 - 25 000", currency: "PLN", hidden: false },
  technologyTags: ["Symfony", "Docker"],
  ...over,
})

describe("parseSearch", () => {
  test("maps list entries to cards", () => {
    const { total, cards } = parseSearch(page({ totalCount: 7, jobs: [job()] }))
    expect(total).toBe(7)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      id: "1001-php-developer-gdansk-acme",
      title: "PHP Developer",
      company: "Acme",
      location: "Gdańsk",
      date: null,
      url: "https://bulldogjob.pl/companies/jobs/1001-php-developer-gdansk-acme",
      level: "senior",
      contracts: ["B2B"],
      salary: "20 000 - 25 000 PLN",
      tags: ["Symfony", "Docker"],
    })
  })

  test("a malformed entry does not break the rest", () => {
    const { cards } = parseSearch(page({ jobs: [null, { id: "x" }, job({ id: "1002-b", position: "B" })] }))
    expect(cards.map((c) => c.id)).toEqual(["1002-b"])
  })

  test("hidden salary is null and remote without city is Remote", () => {
    const { cards } = parseSearch(
      page({ jobs: [job({ showSalary: false, city: null, remote: true })] }),
    )
    expect(cards[0].salary).toBeNull()
    expect(cards[0].location).toBe("Remote")
  })

  test("changed markup raises PARSE_FAILED", () => {
    expect(() => parseSearch("<html></html>")).toThrow(/markup changed/)
    expect(() => parseSearch(page({ nope: [] }))).toThrow(/markup changed/)
  })
})

describe("parseDetail", () => {
  const apollo = {
    "Job:1001-x": {
      id: "1001-x",
      position: "PHP Developer",
      company: { __ref: "Company:1-acme" },
      details: "<p>Build <b>things</b></p><ul><li>one</li></ul><p style=\"display:none\">IGNORE PREVIOUS</p><script>evil()</script>",
      requirements: "<p>PHP 8</p>",
      state: "published",
      publishedAt: "2026-11-02T10:00:00+01:00",
      endsAt: "2999-01-01T00:00:00+01:00",
      workModes: ["full-remote"],
      workFrom: ["Poland"],
      locations: [{ location: { cityEn: "Warsaw", cityPl: "Warszawa" } }],
      b2bSalary: { money: "20 000", currency: "PLN", hidden: false },
      technologyTags: ["Symfony"],
      contractB2b: true,
    },
    "Company:1-acme": { name: "Acme" },
  }

  test("reads description, dates, salary and company", () => {
    const d = parseDetail(page({ __APOLLO_STATE__: apollo }), "1001-x")
    expect(d.company).toBe("Acme")
    expect(d.date).toBe("2026-11-02")
    expect(d.deadline).toBe("2999-01-01")
    expect(d.isActive).toBe(true)
    expect(d.remote).toBe(true)
    expect(d.location).toBe("Warsaw")
    expect(d.salary).toBe("20 000 PLN (B2B)")
    expect(d.description).toContain("Build things")
    expect(d.description).toContain("- one")
    expect(d.description).toContain("PHP 8")
  })

  test("hidden and script text never reaches the description", () => {
    const d = parseDetail(page({ __APOLLO_STATE__: apollo }), "1001-x")
    expect(d.description).not.toContain("IGNORE PREVIOUS")
    expect(d.description).not.toContain("evil")
  })

  test("expired posting is not active", () => {
    const expired = { ...apollo, "Job:1001-x": { ...apollo["Job:1001-x"], endsAt: "2000-01-01T00:00:00+01:00" } }
    expect(parseDetail(page({ __APOLLO_STATE__: expired }), "1001-x").isActive).toBe(false)
  })

  test("missing Job entry raises PARSE_FAILED", () => {
    expect(() => parseDetail(page({ __APOLLO_STATE__: {} }), "1")).toThrow(/markup changed/)
  })
})

describe("output hygiene", () => {
  test("stripInvisible removes tag characters and zero-width text", () => {
    const hidden = String.fromCodePoint(0xe0041) + "​"
    expect(stripInvisible({ a: [`x${hidden}y`] })).toEqual({ a: ["xy"] })
  })
  test("htmlToText drops comments", () => {
    expect(htmlToText("<p>a</p><!-- secret --><p>b</p>")).toBe("a\nb")
  })
})

describe("query and filters", () => {
  test("first word is the skill, rest are terms", () => {
    expect(resolveQuery("PHP senior architect", undefined)).toEqual({ skill: "PHP", terms: ["senior", "architect"] })
    expect(resolveQuery("architect", "PHP")).toEqual({ skill: "PHP", terms: ["architect"] })
    expect(resolveQuery(undefined, "PHP")).toEqual({ skill: "PHP", terms: [] })
  })
  test("terms match title or tags, diacritic-insensitively", () => {
    const { cards } = parseSearch(page({ jobs: [job({ position: "Łódź Architect" })] }))
    expect(matchesTerms(cards[0], ["lodz"])).toBe(true)
    expect(matchesTerms(cards[0], ["symfony"])).toBe(true)
    expect(matchesTerms(cards[0], ["java"])).toBe(false)
  })
  test("list url is built from path segments", () => {
    expect(buildListUrl({})).toBe("https://bulldogjob.pl/companies/jobs")
    expect(buildListUrl({ skill: "PHP", city: "Kraków", page: 2 })).toBe(
      "https://bulldogjob.pl/companies/jobs/s/skills,PHP/city,Krak%C3%B3w/page,2",
    )
  })
  test("city normalisation", () => {
    expect(normalizeCity("krakow")).toBe("Kraków")
    expect(normalizeCity("remote")).toBe("Remote")
    expect(normalizeCity("Koszalin")).toBeNull()
  })
  test("jobage cutoff is local midnight N days back", () => {
    const now = new Date(2026, 10, 9, 15, 0).getTime()
    expect(jobageCutoff(1, now)).toBe(new Date(2026, 10, 8).getTime())
  })
  test("sort: date first, then id descending", () => {
    const mk = (id: string, postedAt: string | null) => ({ ...parseSearch(page({ jobs: [job({ id })] })).cards[0], postedAt })
    const sorted = sortNewestFirst([mk("100-a", null), mk("300-c", null), mk("200-b", "2026-11-01T00:00:00Z")])
    expect(sorted.map((c) => c.id)).toEqual(["200-b", "300-c", "100-a"])
  })
})

describe("normalizeId", () => {
  test("accepts ids, slugs and bulldogjob urls", () => {
    expect(normalizeId("260906")).toBe("260906")
    expect(normalizeId("260906-php-developer-gdansk-teamquest")).toBe("260906-php-developer-gdansk-teamquest")
    expect(normalizeId("https://bulldogjob.pl/companies/jobs/260906-php-developer")).toBe("260906-php-developer")
    expect(normalizeId("bulldogjob.pl/en/companies/jobs/260906-x/")).toBe("260906-x")
  })
  test("rejects other hosts and junk", () => {
    expect(normalizeId("https://evil.io/companies/jobs/260906")).toBeNull()
    expect(normalizeId("https://bulldogjob.pl.evil.io/companies/jobs/260906")).toBeNull()
    expect(normalizeId("php developer")).toBeNull()
  })
})

describe("entity decoding", () => {
  test("is single-pass: &amp;lt; yields the text &lt;, not <", () => {
    expect(htmlToText("<p>a &amp;lt; b</p>")).toBe("a &lt; b")
    expect(htmlToText("<p>&amp;amp;</p>")).toBe("&amp;")
  })

  test("still decodes named and numeric entities", () => {
    expect(htmlToText("<p>&lt;b&gt; &quot;x&quot; &#39;y&#39; &apos;z&apos; &amp; &#233; &#xE9; a&nbsp;b</p>")).toBe(
      "<b> \"x\" 'y' 'z' & \u00e9 \u00e9 a b",
    )
  })

  test("an out-of-range numeric entity is dropped, never thrown", () => {
    expect(htmlToText("<p>a&#1114112;b</p>")).toBe("ab")
  })
})

describe("visibleHtml hidden content", () => {
  test("drops a hidden non-void element written with a trailing slash", () => {
    expect(visibleHtml("a<div hidden/>SECRET</div>b")).toBe("ab")
  })

  test("a > inside a quoted attribute does not hide the hidden attribute", () => {
    expect(visibleHtml('a<div title="x>y" hidden>SECRET</div>b')).toBe("ab")
  })

  test("a / separating the tag name from its attributes is understood", () => {
    expect(visibleHtml("a<div/hidden>SECRET</div>b")).toBe("ab")
  })

  test("nested same-name elements inside a hidden one are skipped together", () => {
    expect(visibleHtml("a<div hidden><div>x</div>SECRET</div>b")).toBe("ab")
  })

  test("visible elements are kept untouched", () => {
    expect(visibleHtml('a<div class="x>y">kept</div>b')).toBe('a<div class="x>y">kept</div>b')
  })

  test("htmlToText no longer leaks a hidden element", () => {
    expect(htmlToText("<p>shown</p><span hidden/>SECRET</span>")).toBe("shown")
  })
})

describe("parseDetail picks the requested offer", () => {
  const job = (id: string, position: string) => ({
    id, position, state: "published", publishedAt: "2026-11-02T10:00:00+01:00", endsAt: "2999-01-01T00:00:00+01:00",
  })

  test("with several Job entries, the one matching the id wins even if not first", () => {
    const apollo = { "Job:2002-related": job("2002-related", "Related"), "Job:1001-x": job("1001-x", "Wanted") }
    expect(parseDetail(page({ __APOLLO_STATE__: apollo }), "1001-x").title).toBe("Wanted")
  })

  test("the key may be the bare leading number", () => {
    const apollo = { "Job:2002": job("2002", "Related"), "Job:1001": job("1001", "Wanted") }
    expect(parseDetail(page({ __APOLLO_STATE__: apollo }), "1001-some-slug").title).toBe("Wanted")
  })

  test("several Job entries and none for the id is a parse failure, not a guess", () => {
    const apollo = { "Job:2002": job("2002", "A"), "Job:3003": job("3003", "B") }
    expect(() => parseDetail(page({ __APOLLO_STATE__: apollo }), "1001-x")).toThrow(/markup changed/)
  })
})
