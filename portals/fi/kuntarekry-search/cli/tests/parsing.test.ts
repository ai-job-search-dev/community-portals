import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { finnishDate, htmlToText, normalizeJobRef, toResult } from "../src/helpers"
import { filterParams, foldName, parseFilters, resolveNames } from "../src/filters"
import { parseDetail } from "../src/commands/detail"
import { FIXTURES } from "./helpers"

const searchFixture = await Bun.file(join(FIXTURES, "search.json")).json()
const filtersFixture = await Bun.file(join(FIXTURES, "filters.json")).json()
const detailFixture = await Bun.file(join(FIXTURES, "detail-vaasa-harjoittelija.html")).text()
const SLUG = "korkeakouluharjoittelija-varhaiskasvatuksen-hallintoon-vsa905-02-212-26"

describe("toResult", () => {
  test("maps a captured row to the portal contract", () => {
    const job = toResult(searchFixture.jobs[1])!
    expect(job).toEqual({
      id: SLUG,
      title: "Korkeakouluharjoittelija varhaiskasvatuksen hallintoon",
      company: "Vaasan kaupunki",
      unit: null,
      location: "Vaasa",
      region: "Pohjanmaa",
      date: "2026-11-23",
      deadline: "2027-01-06",
      employmentType: "Harjoittelu",
      profession: "Opetus- ja kulttuuriala",
      jobKey: "VSA905-02-212-26",
      url: `https://kuntarekry.fi/fi/tyopaikat/${SLUG}/`,
    })
  })

  test("takes the employer from the profit centre's first segment and keeps the unit", () => {
    const job = toResult({
      name: "keittaja-sotepe-01-340-26", url: "/fi/tyopaikat/keittaja-sotepe-01-340-26/", title: "Keittäjä",
      profit_center: "Helsingin kaupunki", organisation_title: "Sosiaali- ja terveystoimiala",
      location_tags: ["Helsinki"], region: "Uusimaa", publication_date: "25.11.2026", publication_end: "9.12.2026",
    })!
    expect(job.company).toBe("Helsingin kaupunki")
    expect(job.unit).toBe("Sosiaali- ja terveystoimiala")
    const turku = toResult({ ...searchFixture.jobs[0], profit_center: "Åbo stad, Svenskspråkig fostran" })!
    expect(turku.company).toBe("Åbo stad")
  })

  test("joins several municipalities and nulls missing values instead of omitting them", () => {
    const job = toResult({ name: "x-1", url: "/fi/tyopaikat/x-1/", title: "Hammashoitaja", location_tags: ["Espoo", "Hanko"] })!
    expect(job.location).toBe("Espoo, Hanko")
    for (const key of ["company", "region", "date", "deadline", "employmentType", "jobKey"] as const) expect(job[key]).toBeNull()
  })

  test("rejects rows whose URL does not match their slug, or that lack a title", () => {
    expect(toResult({ name: "a-1", url: "https://evil.example/fi/tyopaikat/a-1/", title: "T" })).toBeNull()
    expect(toResult({ name: "a-1", url: "/fi/tyopaikat/b-2/", title: "T" })).toBeNull()
    expect(toResult({ name: "a-1", url: "/fi/tyopaikat/a-1/", title: " " })).toBeNull()
    expect(toResult(null)).toBeNull()
    expect(toResult([])).toBeNull()
  })
})

describe("finnishDate", () => {
  test("converts the board's day.month.year dates", () => {
    expect(finnishDate("6.1.2027")).toBe("2027-01-06")
    expect(finnishDate("25.11.2026")).toBe("2026-11-25")
  })
  test("refuses impossible or malformed dates", () => {
    for (const v of ["31.2.2026", "2026-11-25", "", "1.13.2026", null, 5]) expect(finnishDate(v)).toBeNull()
  })
})

describe("normalizeJobRef", () => {
  test("accepts a slug, a path and both hostnames", () => {
    for (const input of [SLUG, `/fi/tyopaikat/${SLUG}/`, `https://kuntarekry.fi/fi/tyopaikat/${SLUG}/`, `https://www.kuntarekry.fi/fi/tyopaikat/${SLUG}`, `kuntarekry.fi/fi/tyopaikat/${SLUG}/`]) {
      expect(normalizeJobRef(input)).toBe(SLUG)
    }
  })
  test("refuses other hosts, credentials, ports and non-job paths", () => {
    for (const input of [
      `https://kuntarekry.fi.evil.example/fi/tyopaikat/${SLUG}/`, `https://user@kuntarekry.fi/fi/tyopaikat/${SLUG}/`,
      `https://kuntarekry.fi:8443/fi/tyopaikat/${SLUG}/`, "https://kuntarekry.fi/fi/tyopaikat/", "ftp://kuntarekry.fi/fi/tyopaikat/a-1/",
      "../../etc/passwd", "a b", "",
    ]) expect(normalizeJobRef(input)).toBeNull()
  })
})

describe("filters", () => {
  const items = parseFilters(filtersFixture)

  test("flattens regions, their municipalities and the fixed vocabularies", () => {
    expect(items.find((i) => i.title === "Uusimaa")).toEqual({ id: "39494", title: "Uusimaa", kind: "region" })
    expect(items.find((i) => i.title === "Helsinki")).toEqual({ id: "39500", title: "Helsinki", kind: "location" })
    expect(items.find((i) => i.title === "Harjoittelu")?.kind).toBe("type")
    expect(items.find((i) => i.title === "Hyvinvointialue")?.kind).toBe("organisationtype")
  })

  test("matches names without case or accents, and English aliases", () => {
    expect(foldName("Hämeenlinna")).toBe("hameenlinna")
    expect(resolveNames("hameenlinna", ["region", "location"], items, "location")[0].title).toBe("Hämeenlinna")
    expect(resolveNames("internship", ["type"], items, "type")[0].title).toBe("Harjoittelu")
    expect(resolveNames("summer job", ["type"], items, "type")[0].title).toBe("Kesätyö")
    expect(resolveNames("wellbeing", ["organisationtype"], items, "org-type")[0].id).toBe("992177")
  })

  test("groups several names into one comma-separated parameter per kind", () => {
    const picked = resolveNames("Helsinki, Espoo,Uusimaa", ["region", "location"], items, "location")
    expect(filterParams(picked)).toEqual({ location: "39500,39496", region: "39494" })
  })

  test("an unknown name is an error with suggestions; a small vocabulary lists every value", () => {
    expect(() => resolveNames("Helsinkk", ["region", "location"], items, "location")).toThrow(/Unknown --location value "Helsinkk"; did you mean: Helsinki/)
    expect(() => resolveNames("foo", ["type"], items, "type")).toThrow(/valid values: .*Harjoittelu/)
  })

  test("names of Object.prototype members are unknown names, not aliases", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(() => resolveNames(name, ["type"], items, "type")).toThrow(/Unknown --type value/)
    }
  })

  test("an ambiguous prefix is refused rather than guessed", () => {
    // "Ha" prefixes Hanko and Hämeenlinna.
    expect(() => resolveNames("Ha", ["region", "location"], items, "location")).toThrow(/Ambiguous/)
  })

  test("refuses filter data without its locations list", () => {
    expect(() => parseFilters({ types: [] })).toThrow(/locations/)
  })
})

/** A moment in Finnish time (EET in winter). */
const fi = (dateTime: string) => Date.parse(`${dateTime}+02:00`)

describe("parseDetail", () => {
  const job = parseDetail(detailFixture, SLUG, fi("2026-11-25T12:00:00"))

  test("reads the facts table, JSON-LD and apply link", () => {
    expect(job.title).toBe("Korkeakouluharjoittelija varhaiskasvatuksen hallintoon")
    expect(job.company).toBe("Vaasan kaupunki")
    expect(job.location).toBe("Vaasa")
    expect(job.region).toBe("Pohjanmaa")
    expect(job.date).toBe("2026-11-23")
    expect(job.deadline).toBe("2027-01-06")
    expect(job.deadlineTime).toBe("23:59")
    expect(job.isActive).toBe(true)
    expect(job.employmentType).toBe("Määräaikainen")
    expect(job.contractType).toBe("Työsuhde")
    expect(job.salary).toBe("1521,32€/kk")
    expect(job.jobKey).toBe("VSA905-02-212-26")
    expect(job.applyUrl).toBe("https://www.kuntarekrytointi.fi/portal/candidate/application/752278?portalId=rekryfi")
    expect(job.url).toBe(`https://kuntarekry.fi/fi/tyopaikat/${SLUG}/`)
  })

  test("the description is the lead plus titled sections, decoded, without the facts table", () => {
    expect(job.description).toStartWith("Jos haluat ymmärtää varhaiskasvatusta")
    expect(job.description).toContain("Tehtävän kuvaus\nHaemme Vaasan kaupungin varhaiskasvatukseen maisteriopiskelijaa korkeakouluharjoitteluun määräaikaiseen tehtävään")
    expect(job.description).toContain("\n• auditointien valmistelua ja toteuttamista")
    expect(job.description).toContain("Yhteystiedot\n")
    expect(job.description).not.toContain("Työpaikan tiedot")
    expect(job.description).not.toMatch(/&#x|<\/?[a-z]/i)
  })

  test("a deadline in the past marks the job closed", () => {
    expect(parseDetail(detailFixture, SLUG, fi("2027-01-07T12:00:00")).isActive).toBe(false)
  })

  test("on the deadline day the job closes at the deadline's time, not at midnight", () => {
    const noon = detailFixture.replaceAll("klo 23:59", "klo 12:00").replace('publication-end-time="23:59"', 'publication-end-time="12:00"')
    expect(parseDetail(noon, SLUG, fi("2027-01-06T11:30:00"))).toMatchObject({ deadline: "2027-01-06", deadlineTime: "12:00", isActive: true })
    expect(parseDetail(noon, SLUG, fi("2027-01-06T12:30:00")).isActive).toBe(false)
  })

  test("without the facts table, dates come from the page attributes, then from JSON-LD", () => {
    const noFacts = detailFixture.replace('title="Työpaikan tiedot"', 'title="Muuta"')
    // Without JSON-LD dates too, so only the page attributes can supply them.
    const attrsOnly = noFacts.replace('"datePosted":"2026-11-23T11:21:00+02:00",', "").replace(',"validThrough":"2027-01-06T23:59:00+02:00"', "")
    expect(attrsOnly).not.toContain("validThrough")
    expect(attrsOnly).not.toContain("datePosted")
    expect(parseDetail(attrsOnly, SLUG, fi("2026-11-25T12:00:00"))).toMatchObject({ date: "2026-11-23", deadline: "2027-01-06", deadlineTime: "23:59", isActive: true })
    const ldOnly = noFacts
      .replace('publication-date="23.11.2026"', "")
      .replace('publication-end-time="23:59"', "")
      .replace('publication-end="6.1.2027"', "")
    expect(parseDetail(ldOnly, SLUG, fi("2026-11-25T12:00:00"))).toMatchObject({ date: "2026-11-23", deadline: "2027-01-06", deadlineTime: "23:59" })
    // The posting date is never guessed from the start of the application period.
    const noPostedDate = ldOnly.replace('"datePosted":"2026-11-23T11:21:00+02:00",', "")
    expect(parseDetail(noPostedDate, SLUG).date).toBeNull()
  })

  test("a JSON-LD timestamp in UTC or another offset is converted to Finnish time", () => {
    const ldOnly = detailFixture.replace('title="Työpaikan tiedot"', 'title="Muuta"')
      .replace('publication-date="23.11.2026"', "").replace('publication-end-time="23:59"', "").replace('publication-end="6.1.2027"', "")
    const at = (posted: string, until: string) => parseDetail(
      ldOnly.replace('"datePosted":"2026-11-23T11:21:00+02:00"', `"datePosted":"${posted}"`).replace('"validThrough":"2027-01-06T23:59:00+02:00"', `"validThrough":"${until}"`),
      SLUG, fi("2027-01-06T12:00:00"))
    expect(at("2026-11-22T22:30:00Z", "2027-01-06T21:59:00Z")).toMatchObject({ date: "2026-11-23", deadline: "2027-01-06", deadlineTime: "23:59", isActive: true })
    // 22:30 UTC on the 6th is already 00:30 on the 7th in Finland.
    expect(at("2026-11-23", "2027-01-06T22:30:00Z")).toMatchObject({ date: "2026-11-23", deadline: "2027-01-07", deadlineTime: "00:30" })
    // Without an offset the time is Finnish local time, as written.
    expect(at("2026-11-23T11:21:00", "2027-01-06T11:00:00")).toMatchObject({ deadline: "2027-01-06", deadlineTime: "11:00", isActive: false })
    // Surrounding whitespace is ignored for instants as for local times.
    expect(at(" 2026-11-22T22:30:00Z ", " 2027-01-06T21:59:00Z ")).toMatchObject({ date: "2026-11-23", deadlineTime: "23:59" })
    // A malformed time is unusable as a whole: no date or deadline is taken from it.
    for (const bad of ["2027-01-06T23:59:99", "2027-01-06T24:00:00", "2027-01-06T23:60", "2027-01-06T23:59:99+02:00"]) {
      expect(at(bad, bad)).toMatchObject({ date: null, deadline: null, deadlineTime: null, isActive: null })
    }
  })

  test("a posting with several places lists every locality once", () => {
    const vaasa = '{"@type":"Place","address":{"@type":"PostalAddress","addressRegion":"Pohjanmaa","addressLocality":"Vaasa","postalCode":65100,"streetAddress":"Vaasa"}}'
    const mustasaari = '{"@type":"Place","address":{"@type":"PostalAddress","addressRegion":"Pohjanmaa","addressLocality":"Mustasaari"}}'
    const page = detailFixture.replace(`"jobLocation":${vaasa}`, `"jobLocation":[${vaasa},${mustasaari},${vaasa}]`)
    expect(page).not.toBe(detailFixture)
    expect(parseDetail(page, SLUG)).toMatchObject({ location: "Vaasa, Mustasaari", region: "Pohjanmaa" })
  })

  test("a JSON-LD salary is read as text, a number or a QuantitativeValue", () => {
    const noFact = detailFixture.replace('title="Palkka"', 'title="Palkkaus"')
    expect(parseDetail(noFact, SLUG).salary).toBe("1521,32€/kk")
    const number = noFact.replace('"value":"1521,32€/kk"', '"value":1521.32')
    expect(parseDetail(number, SLUG).salary).toBe("1521.32 EUR")
    const range = noFact.replace('"value":"1521,32€/kk"', '"value":{"@type":"QuantitativeValue","minValue":2000,"maxValue":2500,"unitText":"MONTH"}')
    expect(parseDetail(range, SLUG).salary).toBe("2000-2500 EUR / month")
  })

  test("a page without a title is a bad response, not an empty job", () => {
    expect(() => parseDetail("<html><body>Not a job</body></html>", SLUG)).toThrow(/without a job title/)
  })

  test("an apply link with a javascript: scheme is dropped", () => {
    const page = detailFixture.replace(/href="https:\/\/www\.kuntarekrytointi\.fi[^"]*"/, 'href="javascript:alert(1)"')
    expect(parseDetail(page, SLUG).applyUrl).toBeNull()
  })
})

describe("htmlToText", () => {
  test("keeps paragraph and list breaks and decodes entities", () => {
    expect(htmlToText("<p>Hei&nbsp;maailma</p><ul><li>yksi</li><li>kaksi &amp; kolme</li></ul>")).toBe("Hei maailma\n\n• yksi\n• kaksi & kolme")
  })
})
