import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { dutchDate, normalizeVacancyInput, parseDetailPage, parseSearchPage, webUrl } from "../src/parsers.js"

const fixture = (name: string): Promise<string> => Bun.file(join(import.meta.dir, "fixtures", name)).text()

describe("search results component", () => {
  test("parses the total and every card from a captured results component", async () => {
    const page = parseSearchPage(await fixture("search-component.html"))

    expect(page.total).toBe(601)
    expect(page.results).toHaveLength(2)
    expect(page.results[0]).toMatchObject({
      id: "senior-communicatieadviseur-img-622181-DEF2631-2033-6931",
      title: "Senior communicatieadviseur IMG (622181)",
      company: "Ministerie van Defensie",
      location: "Hilversum",
      date: "2026-11-25",
      deadline: "2026-12-21",
      hours: "36 - 38 uur",
      educationLevel: "Hbo",
      url: "https://www.werkenbijdeoverheid.nl/vacatures/senior-communicatieadviseur-img-622181-DEF2631-2033-6931",
    })
    expect(page.results[0]?.salary).toContain("(bruto)")
    expect(page.results[1]).toMatchObject({
      id: "adviseur-bestuurlijke-zaken-VRU-2026-1348",
      company: "Veiligheidsregio Utrecht",
      location: "Utrecht",
    })
  })

  test("skips a card without a vacancy link instead of failing the page", () => {
    const html = `<span class="vacancy-result-bar__totals-badge">2</span>
      <li class="vacancy-list__item"><section class="vacancy"><h2 class="vacancy__title">No link</h2></section></li>
      <li class="vacancy-list__item"><section class="vacancy"><h2 class="vacancy__title"><a href="/vacatures/ok-1">Ok</a></h2></section></li>`
    const page = parseSearchPage(html)
    expect(page.results.map((r) => r.id)).toEqual(["ok-1"])
    expect(page.results[0]?.company).toBeNull()
  })
})

describe("detail page", () => {
  test("reads title, employer and facts from the header and the Dit krijg je section", async () => {
    const detail = parseDetailPage(await fixture("detail-vru.html"))

    expect(detail).toMatchObject({
      id: "adviseur-bestuurlijke-zaken-VRU-2026-1348",
      title: "Adviseur Bestuurlijke Zaken",
      company: "Veiligheidsregio Utrecht",
      location: "Utrecht",
      deadline: "2026-11-28",
      hours: "36 uur",
      educationLevel: "Hbo bachelor",
      contractType: "Arbeidsovereenkomst voor bepaalde tijd met uitzicht op onbepaalde tijd",
      url: "https://www.werkenbijdeoverheid.nl/vacatures/adviseur-bestuurlijke-zaken-VRU-2026-1348",
    })
    expect(detail.salary).toContain("(bruto)")
    expect(detail.applyUrl).toBe("https://vru.nl/werkenbij/vacatures-kantoor-en-ondersteuning/1351623/")
    expect(detail.description).toStartWith("Dit ga je doen")
    expect(detail.description).toContain("Dit vragen wij")
  })

  test("ignores facts of other vacancies' cards after the apply block", async () => {
    const detail = parseDetailPage(await fixture("detail-vru.html"))
    expect(detail.location).not.toBe("Elders")
  })

  test("fails clearly without a canonical vacancy URL", () => {
    expect(() => parseDetailPage("<h1 class=\"job-header__header\">X</h1>")).toThrow("canonical")
  })
})

describe("apply links", () => {
  test("keeps http(s) links, resolves relative ones, and drops other schemes", () => {
    expect(webUrl("https://example.org/apply?id=1&amp;x=2")).toBe("https://example.org/apply?id=1&x=2")
    expect(webUrl("/vacatures/x-1/solliciteren")).toBe("https://www.werkenbijdeoverheid.nl/vacatures/x-1/solliciteren")
    expect(webUrl("javascript:alert(1)")).toBeNull()
    expect(webUrl("data:text/html,hi")).toBeNull()
    expect(webUrl(undefined)).toBeNull()
  })

  test("a javascript: apply link in a page becomes null", () => {
    const html = `<link rel="canonical" href="https://www.werkenbijdeoverheid.nl/vacatures/x-1"/>
      <div class="job-header__title"><h1 class="job-header__header">X</h1></div>
      <button onclick="applyExternClick('javascript:alert(1)')">Solliciteren</button>`
    expect(parseDetailPage(html).applyUrl).toBeNull()
  })
})

describe("input and dates", () => {
  test("accepts a slug, a path or a URL on this site, and rejects other hosts", () => {
    expect(normalizeVacancyInput("adviseur-VRU-2026-1348")).toBe("adviseur-VRU-2026-1348")
    expect(normalizeVacancyInput("/vacatures/adviseur-VRU-2026-1348?x=1")).toBe("adviseur-VRU-2026-1348")
    expect(normalizeVacancyInput("https://www.werkenbijdeoverheid.nl/vacatures/adviseur-VRU-2026-1348")).toBe("adviseur-VRU-2026-1348")
    expect(normalizeVacancyInput("https://www.werkenvoornederland.nl/vacatures/adviseur-VRU-2026-1348")).toBeNull()
    expect(normalizeVacancyInput("https://werkenbijdeoverheid.nl.evil.io/vacatures/x")).toBeNull()
  })

  test("parses Dutch dates inside surrounding text", () => {
    expect(dutchDate("Plaatsingsdatum: 5 november 2026")).toBe("2026-11-05")
    expect(dutchDate("Solliciteer voor 28 november 2026 Nog 2 dagen")).toBe("2026-11-28")
    expect(dutchDate("geen datum")).toBeNull()
  })
})
