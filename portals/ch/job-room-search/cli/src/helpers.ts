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

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export interface HttpResult {
  status: number
  headers: Headers
  body: string
}

/** Fetch JSON with exponential backoff on 429/5xx. */
async function requestWithRetry(
  url: string,
  init: RequestInit,
): Promise<HttpResult> {
  const maxRetries = 6
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
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
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

/** job-room returns some free-text fields (titles, company names) HTML-entity-encoded. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

/** Strip <em>...</em> highlight tags job-room injects around matched keywords, and
 * decode any HTML entities present in the free-text fields. */
export function stripHighlight(text: string | null | undefined): string | null {
  if (text == null) return null
  return decodeHtmlEntities(text.replace(/<\/?em>/gi, ""))
}

export interface JobSummary {
  id: string
  title: string
  company: string | null
  city: string | null
  cantonCode: string | null
  postalCode: string | null
  workloadMin: string | null
  workloadMax: string | null
  permanent: boolean | null
  onlineSince: string | null
  publicationStart: string | null
  publicationEnd: string | null
  externalUrl: string | null
  languageIsoCode: string | null
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
