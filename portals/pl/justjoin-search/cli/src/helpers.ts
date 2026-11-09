// Data source: justjoin.it public job-listing pages (server-rendered).
//
// justjoin.it is a Next.js App Router site: every search page streams its React
// Server Component payload into the HTML as a series of
// `self.__next_f.push([1,"<json-string>"])` calls. Concatenating those chunks
// yields the page's full data payload, which contains the complete offer objects
// the UI renders - title, company, city, workplace type, salary bands, publish
// and expiry dates, required skills. That means one request per search returns
// fully structured results, with no per-result detail fetch needed.
//
// We deliberately do NOT touch api.justjoin.it: its robots.txt is `Disallow: /`
// for generic agents. justjoin.it's own robots.txt disallows /api/ and the
// comma-filtered /oferty-pracy/*,* paths, but leaves /job-offers/ and
// /job-offer/ (the pages this CLI reads) open.

export const BASE = "https://justjoin.it"
export const SEARCH_PATH = "/job-offers"
export const DETAIL_PATH = "/job-offer"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; justjoin-search-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface SalaryBand {
  type: string | null
  from: number | null
  to: number | null
  currency: string | null
  unit: string | null
  gross: boolean | null
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  workplaceType: string | null
  experienceLevel: string | null
  employmentType: string | null
  salary: SalaryBand | null
  deadline: string | null
  skills: string[]
  otherLocations: string[]
}

export interface JobDetail extends JobCard {
  description: string | null
  street: string | null
  country: string | null
  isActive: boolean
}

/**
 * Concatenate the RSC payload streamed into a Next.js App Router page.
 * Each chunk is a JSON string literal, so JSON.parse un-escapes it correctly;
 * a chunk that fails to parse is skipped rather than aborting the whole page.
 */
export function extractRscPayload(html: string): string {
  const chunks: string[] = []
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\[\s\S])*")\]\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      chunks.push(JSON.parse(m[1]!) as string)
    } catch {
      // a truncated or malformed chunk must not cost us the rest of the page
    }
  }
  return chunks.join("")
}

/**
 * Index of the `}` closing the object that starts at `start`, tracking string
 * literals and escapes so braces inside values do not confuse the scan.
 * Returns -1 when the object never closes (truncated payload).
 */
export function matchBraces(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (c === "\\") {
      escaped = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Pull every offer object out of an RSC payload. Offers are chunked and parsed
 * independently, so one malformed offer cannot break the rest of the results.
 */
export function parseOffers(payload: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const seen = new Set<string>()
  const marker = '{"applyUrl":'
  let idx = payload.indexOf(marker)
  while (idx !== -1) {
    const end = matchBraces(payload, idx)
    if (end !== -1) {
      try {
        const obj = JSON.parse(payload.slice(idx, end + 1)) as Record<string, unknown>
        const slug = typeof obj.slug === "string" ? obj.slug : null
        if (slug && !seen.has(slug)) {
          seen.add(slug)
          out.push(obj)
        }
      } catch {
        // skip this offer, keep the others
      }
    }
    idx = payload.indexOf(marker, idx + marker.length)
  }
  return out
}

/** Prefer the band the employer actually published over converted currencies. */
function pickSalary(raw: unknown): SalaryBand | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const bands = raw as Record<string, unknown>[]
  const original = bands.find((b) => b.currencySource === "original") ?? bands[0]!
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null)
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
  if (num(original.from) === null && num(original.to) === null && str(original.type) === null) {
    return null
  }
  return {
    type: str(original.type),
    from: num(original.from),
    to: num(original.to),
    currency: str(original.currency),
    unit: str(original.unit),
    gross: typeof original.gross === "boolean" ? original.gross : null,
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null)

/**
 * Search pages give plain strings for enum-ish fields (workplaceType,
 * experienceLevel); detail pages give `{ label, value }` objects for the same
 * fields. Accept either shape.
 */
export function labelValue(v: unknown): string | null {
  if (typeof v === "string") return v !== "" ? v : null
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    return str(o.value) ?? str(o.label)
  }
  return null
}

/** Skills are `["PHP"]` on search pages and `[{ name: "PHP" }]` on detail pages. */
export function skillNames(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((s) => (typeof s === "string" ? s : str((s as Record<string, unknown>)?.name)))
    .filter((s): s is string => s !== null && s !== "")
}

/**
 * Resolve a streamed RSC text reference (`"$5b"` -> the `5b:T<hexlen>,<text>`
 * chunk). justjoin puts the offer's full HTML description in one of these, so
 * the detail command can recover the real paragraph and bullet structure that
 * the JSON-LD `description` field has already flattened.
 */
export function resolveRscRef(payload: string, ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith("$")) return null
  const id = ref.slice(1)
  if (!/^[0-9a-f]+$/i.test(id)) return null
  const re = new RegExp(`(?:^|\\n)${id}:T([0-9a-f]+),`)
  const m = re.exec(payload)
  if (!m) return null
  const len = parseInt(m[1]!, 16)
  if (!Number.isFinite(len) || len <= 0) return null
  const start = m.index + m[0].length
  return payload.slice(start, start + len)
}

/**
 * The offer object on a detail page is wrapped as `{"offer":{...}}` and never
 * carries the `applyUrl`-first key order that `parseOffers` keys on, so it needs
 * its own extraction.
 */
export function parseDetailOffer(payload: string): Record<string, unknown> | null {
  // Key order inside the envelope is the framework's to change, so we anchor on
  // the `"offer":{` wrapper alone and confirm the parsed object by its slug.
  const marker = '"offer":{'
  let idx = payload.indexOf(marker)
  while (idx !== -1) {
    const start = idx + marker.length - 1
    const end = matchBraces(payload, start)
    if (end !== -1) {
      try {
        const offer = JSON.parse(payload.slice(start, end + 1)) as Record<string, unknown>
        if (typeof offer.slug === "string" && offer.slug !== "") return offer
      } catch {
        // not the offer envelope, keep looking
      }
    }
    idx = payload.indexOf(marker, idx + marker.length)
  }
  return null
}

/** Map a raw justjoin offer object onto the portal-skill result contract. */
export function normalizeOffer(raw: Record<string, unknown>): JobCard | null {
  const id = str(raw.slug)
  const title = str(raw.title) ?? str(raw.body)
  if (!id || !title) return null
  const published = str(raw.publishedAt)
  const multi = Array.isArray(raw.multilocation) ? (raw.multilocation as Record<string, unknown>[]) : []
  const city = str(raw.city)
  const salary = pickSalary(raw.employmentTypes)
  return {
    id,
    title,
    company: str(raw.companyName),
    location: city,
    date: published ? published.slice(0, 10) : null,
    url: `${BASE}${DETAIL_PATH}/${id}`,
    workplaceType: labelValue(raw.workplaceType),
    experienceLevel: labelValue(raw.experienceLevel),
    employmentType: salary?.type ?? null,
    salary,
    deadline: str(raw.expiredAt)?.slice(0, 10) ?? null,
    skills: skillNames(raw.requiredSkills),
    otherLocations: multi
      .map((l) => str(l.city))
      .filter((c): c is string => c !== null && c !== city),
  }
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x?([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(parseInt(code, /^x/i.test(_.slice(2, 3)) ? 16 : 10)),
    )
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*li[^>]*>/gi, "- ")
      .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*\/?>/gi, "\n")
      .replace(/<\/?[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Parse the JobPosting JSON-LD block a justjoin detail page embeds. This is the
 * portal's own structured description of the offer, so it survives markup
 * changes that would break class-name parsing.
 */
export function parseJobDetail(html: string, id: string): JobDetail | null {
  if (!html) return null
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  let posting: Record<string, unknown> | null = null
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b[1]!) as Record<string, unknown>
      if (parsed["@type"] === "JobPosting") {
        posting = parsed
        break
      }
    } catch {
      // ignore a malformed block, try the next one
    }
  }

  // The RSC payload carries fields JSON-LD omits (workplace type, seniority,
  // required skills) and the description's real HTML, so we read both and merge.
  const payload = extractRscPayload(html)
  const rawOffer =
    parseDetailOffer(payload) ??
    parseOffers(payload).find((o) => o.slug === id) ??
    parseOffers(payload)[0] ??
    null
  const card = rawOffer ? normalizeOffer(rawOffer) : null

  // Prefer the streamed HTML body: JSON-LD's `description` is the same text with
  // every paragraph and list break already stripped, which runs sentences together.
  const bodyHtml = rawOffer ? resolveRscRef(payload, rawOffer.body) : null

  if (!posting && !card) return null

  const org = (posting?.hiringOrganization ?? null) as Record<string, unknown> | null
  const place = (posting?.jobLocation ?? null) as Record<string, unknown> | null
  const address = (place?.address ?? null) as Record<string, unknown> | null
  const salaryLd = (posting?.baseSalary ?? null) as Record<string, unknown> | null
  const salaryVal = (salaryLd?.value ?? null) as Record<string, unknown> | null

  const ldSalary: SalaryBand | null = salaryVal
    ? {
        type: null,
        from: typeof salaryVal.minValue === "number" ? salaryVal.minValue : null,
        to: typeof salaryVal.maxValue === "number" ? salaryVal.maxValue : null,
        currency: str(salaryLd?.currency),
        unit: str(salaryVal.unitText)?.toLowerCase() ?? null,
        gross: null,
      }
    : null

  const datePosted = str(posting?.datePosted)
  const validThrough = str(posting?.validThrough)
  const rawDescription = str(posting?.description)

  return {
    id,
    title: str(posting?.title) ?? card?.title ?? id,
    company: str(org?.name) ?? card?.company ?? null,
    location: str(address?.addressLocality) ?? card?.location ?? null,
    date: datePosted ? datePosted.slice(0, 10) : card?.date ?? null,
    url: `${BASE}${DETAIL_PATH}/${id}`,
    workplaceType: card?.workplaceType ?? (str(posting?.jobLocationType) === "TELECOMMUTE" ? "remote" : null),
    experienceLevel: card?.experienceLevel ?? null,
    employmentType: card?.employmentType ?? str(posting?.employmentType),
    salary: card?.salary ?? ldSalary,
    deadline: validThrough ? validThrough.slice(0, 10) : card?.deadline ?? null,
    skills: card?.skills ?? [],
    otherLocations: card?.otherLocations ?? [],
    description: bodyHtml ? stripHtml(bodyHtml) : rawDescription ? stripHtml(rawDescription) : null,
    street: str(address?.streetAddress),
    country: str(address?.addressCountry),
    // An expired offer keeps its page but stops appearing in search; validThrough
    // in the past is the portal's own statement that applications have closed.
    isActive:
      typeof rawOffer?.isOfferActive === "boolean"
        ? (rawOffer.isOfferActive as boolean)
        : validThrough
          ? new Date(validThrough).getTime() > Date.now()
          : true,
  }
}

/** Drop offers published more than `days` ago (justjoin has no server-side age filter). */
export function filterByAge(cards: JobCard[], days: number): JobCard[] {
  if (!Number.isFinite(days) || days <= 0) return cards
  // `date` is day-granular, so compare calendar days: an offer dated on the
  // cutoff's own day may be only hours old and must be kept. Comparing its
  // midnight against now - N*24h dropped yesterday's offers under --jobage 1.
  const cutoffDay = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  return cards.filter((c) => {
    if (!c.date || !/^\d{4}-\d{2}-\d{2}/.test(c.date)) return true // undated offers stay visible rather than vanishing silently
    return c.date.slice(0, 10) >= cutoffDay
  })
}

/** "Warszawa" / "Warsaw, Poland" -> the path slug justjoin uses. */
export function locationSlug(location: string | undefined): string {
  if (!location) return "all-locations"
  const cleaned = location.trim().toLowerCase()
  if (cleaned === "" || cleaned === "all" || cleaned === "poland" || cleaned === "polska") {
    return "all-locations"
  }
  return cleaned
    .split(",")[0]!
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0142/g, "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function slugFromIdOrUrl(input: string): string {
  const trimmed = input.trim()
  if (!/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^\/+|\/+$/g, "")
  try {
    const parts = new URL(trimmed).pathname.split("/").filter(Boolean)
    return parts[parts.length - 1] ?? trimmed
  } catch {
    return trimmed
  }
}

export function formatSalary(s: SalaryBand | null): string {
  if (!s || (s.from === null && s.to === null)) return "-"
  const range = s.from !== null && s.to !== null ? `${s.from}-${s.to}` : String(s.from ?? s.to)
  const parts = [range, s.currency ?? "", s.unit ? `/${s.unit}` : ""].join(" ").replace(/\s+\//, "/")
  return `${parts.trim()}${s.type ? ` (${s.type})` : ""}`
}
