// Data source: job-room.ch — the official Swiss government (SECO / Public Employment
// Service, "Service public de l'emploi") job platform. JSON REST API, no authentication
// required for public reads. Search is POST with a JSON body (Spring-stack DTO,
// `JobAdvertisementSearchRequest`); detail is a plain GET by id.

export const SEARCH_URL =
  "https://www.job-room.ch/jobadservice/api/jobAdvertisements/_search"
export const DETAIL_URL = "https://www.job-room.ch/jobadservice/api/jobAdvertisements"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// Identify the client honestly. The API serves the same 200 to an identifying
// UA as to a spoofed browser one (verified 11 November 2026 against
// /jobadservice/api/jobAdvertisements/_search), so there is no reason to
// present this CLI as a browser.
const UA =
  "job-room-search/1.0 (+https://github.com/ai-job-search-dev/community-portals)"

export interface HttpResult {
  status: number
  headers: Headers
  body: string
}

const MAX_RETRY_AFTER_MS = 30000

/** `Retry-After` is either a count of seconds or an HTTP date. Returns ms, or
 * null when the header is absent or unparseable. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS)
  }
  const date = Date.parse(trimmed)
  if (isNaN(date)) return null
  return Math.min(Math.max(date - now, 0), MAX_RETRY_AFTER_MS)
}

/** Fetch JSON with exponential backoff on 429/5xx. */
async function requestWithRetry(
  url: string,
  init: RequestInit,
): Promise<HttpResult> {
  // Six attempts in total: the first plus five retries.
  const maxRetries = 5
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8,de;q=0.7",
        ...(init.headers || {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        return { status: response.status, headers: response.headers, body: await response.text() }
      }
      // A server that says how long to wait is obeyed; the backoff schedule is
      // the fallback. Capped so a hostile or mistaken header cannot hang the CLI.
      // `||`, not `??`: Retry-After: 0 (or an HTTP date already in the past)
      // parses to 0, and ?? kept it, firing all six requests in a few ms.
      // A server asking for no delay still gets the backoff schedule.
      const retryAfter = parseRetryAfter(response.headers.get("Retry-After"))
      const wait = retryAfter || delay + Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, wait))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    return { status: response.status, headers: response.headers, body: await response.text() }
  }
  throw new Error("Request failed after max retries")
}

export async function postJson(url: string, body: unknown): Promise<HttpResult> {
  return requestWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export async function getJson(url: string): Promise<HttpResult> {
  return requestWithRetry(url, { method: "GET" })
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

// Object.create(null): a plain object literal inherits constructor, toString and
// friends, so "&toString;" resolved to function source text and was spliced into
// the output.
const NAMED_ENTITIES: Record<string, string> = Object.assign(Object.create(null), {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
})

/** job-room returns some free-text fields (titles, company names) HTML-entity-encoded.
 * Decoding happens in a single pass: chained .replace() calls decoded `&amp;` first,
 * so an already-encoded `&amp;lt;` turned into `<` instead of the literal `&lt;`. */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return numericEntity(parseInt(body.slice(2), 16)) || match
    }
    if (body.startsWith("#")) {
      return numericEntity(parseInt(body.slice(1), 10)) || match
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match
  })
}

/** Strip <em>...</em> highlight tags job-room injects around matched keywords, and
 * decode any HTML entities present in the free-text fields. */
export function stripHighlight(text: string | null | undefined): string | null {
  if (text == null) return null
  return decodeHtmlEntities(text.replace(/<\/?em>/gi, ""))
}

// Copied verbatim from portals/global/linkedin-search/cli/src/helpers.ts
// (db82b72), so the six portals that strip hidden text share one definition.
/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 * Listing text is third-party data, and these arrive raw in a portal's JSON or
 * markup as easily as through a numeric entity.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

export interface JobSummary {
  id: string
  title: string
  company: string | null
  city: string | null
  cantonCode: string | null
  postalCode: string | null
  // Strings, not numbers: the API returns workloadPercentageMin: "100".
  // Verified against a live search response on 11 November 2026, as
  // url-reference.md records. Passed through unchanged.
  workloadMin: string | null
  workloadMax: string | null
  permanent: boolean | null
  onlineSince: string | null
  publicationStart: string | null
  publicationEnd: string | null
  externalUrl: string | null
  languageIsoCode: string | null
  // The job registration requirement (Stellenmeldepflicht), as the API reports
  // it. An anonymous client only ever sees these ads after the exclusivity
  // window has closed, so reportingObligationEndDate reads as "this was an
  // obligation posting and its RAV-only window ended on this date".
  reportingObligation: boolean | null
  reportingObligationEndDate: string | null
}

export interface JobDetail extends JobSummary {
  description: string | null
  descriptionsByLanguage: { languageIsoCode: string; title: string; description: string }[]
  street: string | null
  houseNumber: string | null
  countryIsoCode: string | null
  workForms: string[]
  startDate: string | null
  endDate: string | null
  applyChannel: unknown
  createdTime: string | null
  status: string | null
  sourceSystem: string | null
}

/** Pick the preferred-language description, falling back to the first available. */
function pickDescription(
  descriptions: { languageIsoCode: string; title: string; description: string }[],
  preferredLangs: string[],
): { languageIsoCode: string; title: string; description: string } | null {
  if (!descriptions || descriptions.length === 0) return null
  for (const lang of preferredLangs) {
    const hit = descriptions.find((d) => d.languageIsoCode === lang)
    if (hit) return hit
  }
  return descriptions[0]
}

/** Map one `{jobAdvertisement: {...}}` search-hit envelope to a flat summary. */
export function toSummary(hit: any, preferredLangs: string[] = ["fr", "de", "en", "it"]): JobSummary {
  const ad = hit.jobAdvertisement ?? hit
  const content = ad.jobContent ?? {}
  const desc = pickDescription(content.jobDescriptions ?? [], preferredLangs)
  const location = content.location ?? {}
  const employment = content.employment ?? {}
  const company = content.company ?? {}
  const publication = ad.publication ?? {}

  return {
    id: ad.id,
    title: stripHighlight(desc?.title) ?? "(untitled)",
    company: company.name ? stripHighlight(company.name) : null,
    city: location.city ?? null,
    cantonCode: location.cantonCode ?? null,
    postalCode: location.postalCode ?? null,
    workloadMin: employment.workloadPercentageMin ?? null,
    workloadMax: employment.workloadPercentageMax ?? null,
    permanent: typeof employment.permanent === "boolean" ? employment.permanent : null,
    onlineSince: ad.createdTime ? ad.createdTime.slice(0, 10) : null,
    publicationStart: publication.startDate ?? null,
    publicationEnd: publication.endDate ?? null,
    externalUrl: content.externalUrl ?? null,
    languageIsoCode: desc?.languageIsoCode ?? null,
    reportingObligation:
      typeof ad.reportingObligation === "boolean" ? ad.reportingObligation : null,
    reportingObligationEndDate: ad.reportingObligationEndDate ?? null,
  }
}

/** Map a raw jobAdvertisement object (GET-by-id response) to a full detail record. */
export function toDetail(ad: any, preferredLangs: string[] = ["fr", "de", "en", "it"]): JobDetail {
  const summary = toSummary({ jobAdvertisement: ad }, preferredLangs)
  const content = ad.jobContent ?? {}
  const descriptions = (content.jobDescriptions ?? []).map((d: any) => ({
    languageIsoCode: d.languageIsoCode,
    title: stripHighlight(d.title) ?? "",
    description: stripHighlight(d.description) ?? "",
  }))
  const desc = pickDescription(descriptions, preferredLangs)
  const location = content.location ?? {}
  const employment = content.employment ?? {}

  return {
    ...summary,
    description: desc?.description ?? null,
    descriptionsByLanguage: descriptions,
    street: location.street ?? null,
    houseNumber: location.houseNumber ?? null,
    countryIsoCode: location.countryIsoCode ?? null,
    workForms: employment.workForms ?? [],
    startDate: employment.startDate ?? null,
    endDate: employment.endDate ?? null,
    applyChannel: content.applyChannel ?? null,
    createdTime: ad.createdTime ?? null,
    status: ad.status ?? null,
    sourceSystem: ad.sourceSystem ?? null,
  }
}

/** Romandie canton codes accepted by the API, for reference/validation help. */
export const ROMANDIE_CANTONS: Record<string, string> = {
  GE: "Geneva",
  VD: "Vaud",
  VS: "Valais",
  NE: "Neuchâtel",
  FR: "Fribourg",
  JU: "Jura",
}
