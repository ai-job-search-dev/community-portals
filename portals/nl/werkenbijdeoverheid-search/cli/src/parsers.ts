// Search cards follow werkenvoornederland-search by Fabian Schreuder
// (github.com/Fabian-Schreuder/ai-job-search-nl, MIT): both sites run on the
// same platform and render the same result component. Detail pages differ:
// Werken bij de Overheid publishes no JobPosting JSON-LD, so the detail
// parser reads the page header and its text sections instead.

import { BASE_URL } from "./http.js"
import { toVacancyResult, visibleHtml } from "./helpers.js"
import type { SearchPage, VacancyDetail, VacancyResult } from "./types.js"

const MONTHS: Readonly<Record<string, string>> = {
  januari: "01", februari: "02", maart: "03", april: "04", mei: "05", juni: "06",
  juli: "07", augustus: "08", september: "09", oktober: "10", november: "11", december: "12",
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, value: string) => {
      const cp = Number(value)
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
    })
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex: string) => {
      const cp = parseInt(hex, 16)
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
    })
    .replace(/&amp;/g, "&")
}

/** Readable text of an HTML fragment: hidden markup dropped, block ends as line breaks. */
export function cleanHtml(html: string): string {
  return decodeHtml(
    visibleHtml(html)
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|section|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function capture(html: string, pattern: RegExp): string | null {
  const value = pattern.exec(html)?.[1]
  return value ? cleanHtml(value) || null : null
}

/** "25 november 2026" (anywhere in the text) as 2026-11-25. */
export function dutchDate(value: string | null): string | null {
  if (!value) return null
  const match = /\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/i.exec(value)
  if (!match) return null
  const month = MONTHS[(match[2] ?? "").toLowerCase()]
  const day = match[1]
  const year = match[3]
  return month && day && year ? `${year}-${month}-${day.padStart(2, "0")}` : null
}

/** The value next to an icon titled `title` in a job-short-info list. */
function labelledValue(chunk: string, title: string): string | null {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const value = capture(
    chunk,
    new RegExp(`title="${escaped}"[\\s\\S]*?class="job-short-info__value[^"]*"[^>]*>([\\s\\S]*?)<\\/li>`, "i"),
  )
  return value?.replace(/\s+/g, " ").replace(/\s*-\s*route$/i, "").trim() || null
}

function parseCard(chunk: string): VacancyResult | null {
  const link = /class="vacancy__title"[\s\S]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk)
  const path = link?.[1]
  const titleHtml = link?.[2]
  if (!path || !titleHtml) return null
  const id = normalizeVacancyInput(path)
  const title = cleanHtml(titleHtml)
  if (!id || !title) return null
  return toVacancyResult({
    id,
    title,
    company: capture(chunk, /class="vacancy__employer"[^>]*>([\s\S]*?)<\/p>/i),
    location: labelledValue(chunk, "Locatie"),
    date: dutchDate(capture(chunk, /class="job-short-info__top"[^>]*>([\s\S]*?)<\/div>/i)),
    deadline: dutchDate(capture(chunk, /class="vacancy-publication-end"[^>]*>([\s\S]*?)<\/span>/i)),
    hours: labelledValue(chunk, "Uren per week"),
    salary: labelledValue(chunk, "Salaris"),
    educationLevel: labelledValue(chunk, "Niveau"),
    contractType: labelledValue(chunk, "Arbeidsovereenkomst"),
    summary: capture(chunk, /class="vacancy__description"[^>]*>([\s\S]*?)<\/p>/i),
  })
}

/** The results component: each card is parsed on its own, so one broken card cannot break the rest. */
export function parseSearchPage(html: string): SearchPage {
  const totalText = capture(html, /class="vacancy-result-bar__totals-badge"[^>]*>([\s\S]*?)<\//i)
    ?? capture(html, /role="status"[^>]*>([\s\S]*?)<\//i)
  const total = totalText ? Number(totalText.replace(/\D/g, "")) || 0 : 0
  const chunks = html.split(/<li[^>]*class="[^"]*vacancy-list__item[^"]*"[^>]*>/i).slice(1)
  const results: VacancyResult[] = []
  for (const chunk of chunks) {
    const card = parseCard(chunk)
    if (card) results.push(card)
  }
  return { total, results }
}

/** A vacancy slug from a slug, a /vacatures/<slug> path or a full URL on this site. */
export function normalizeVacancyInput(input: string): string | null {
  const trimmed = input.trim()
  if (/^[a-z0-9][a-z0-9-]*$/i.test(trimmed)) return trimmed
  const relative = /^\/vacatures\/([a-z0-9][a-z0-9-]*)\/?(?:[?#].*)?$/i.exec(trimmed)
  if (relative?.[1]) return relative[1]
  try {
    const url = new URL(trimmed)
    if (url.origin !== BASE_URL) return null
    const match = /^\/vacatures\/([a-z0-9][a-z0-9-]*)\/?$/i.exec(url.pathname)
    return match?.[1] ?? null
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
}

const SECTION_IDS = [
  "dit_ga_je_doen_anchor", "dit_krijg_je_anchor", "dit_bieden_wij_nog_meer_anchor",
  "dit_vragen_wij_anchor", "hier_kom_je_te_werken_anchor", "bijzonderheden_anchor",
] as const

function detailSections(html: string): string {
  const sections: string[] = []
  for (const id of SECTION_IDS) {
    const pattern = new RegExp(`<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)(?=<section\\b|<div[^>]*class="[^"]*(?:job-contact|apply-job)|$)`, "i")
    const section = capture(html, pattern)
    if (section) sections.push(section)
  }
  return sections.join("\n\n")
}

/** An absolute http(s) URL, relative links resolved against the site; anything else (javascript:, data:, garbage) is null. */
export function webUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(decodeHtml(raw).trim(), BASE_URL)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
}

/** A detail page, read from its header (title, employer, key facts) and text sections. */
export function parseDetailPage(html: string): VacancyDetail {
  const canonical = /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i.exec(html)?.[1]
  const id = canonical ? normalizeVacancyInput(decodeHtml(canonical)) : null
  if (!id) throw new SyntaxError("canonical vacancy URL is missing")
  const title = capture(html, /<h1[^>]*class="[^"]*job-header__header[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
  if (!title) throw new SyntaxError("vacancy title is missing")
  // Facts sit in the header and in the "Dit krijg je" section; the
  // job-short-info lists after the contact/apply block belong to other
  // vacancies' cards, so the search for labelled values stops there.
  const start = html.search(/class="job-header__title"/i)
  const header = start === -1 ? html : html.slice(start)
  const end = header.search(/class="[^"]*(?:job-contact|apply-job)/i)
  const facts = end === -1 ? header : header.slice(0, end)
  const apply = /applyExternClick\('([^']+)'\)/i.exec(html)?.[1]
  return {
    id,
    title,
    company: capture(facts, /class="job-header__title__link"[^>]*>([\s\S]*?)<\/a>/i),
    location: labelledValue(facts, "Locatie"),
    deadline: dutchDate(capture(facts, /class="vacancy-publication-end"[^>]*>([\s\S]*?)<\//i)),
    hours: labelledValue(facts, "Uren per week"),
    salary: labelledValue(facts, "Salaris"),
    salaryDescription: labelledValue(facts, "Salarisomschrijving"),
    educationLevel: labelledValue(facts, "Niveau"),
    field: labelledValue(facts, "Vakgebied"),
    contractType: labelledValue(facts, "Arbeidsovereenkomst"),
    contractDuration: labelledValue(facts, "Contractduur"),
    url: `${BASE_URL}/vacatures/${id}`,
    applyUrl: webUrl(apply),
    description: detailSections(html),
  }
}
