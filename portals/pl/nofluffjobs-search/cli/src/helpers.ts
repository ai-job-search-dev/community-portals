// Data source: nofluffjobs.com's public, server-rendered listing pages.
//
// No Fluff Jobs is an Angular app with server-side rendering, so a plain fetch
// returns the full result list as HTML. The cards are anchored by Angular's
// `data-cy` test attributes and semantic component tags rather than by
// build-hashed class names, which makes them a stable parsing target.
//
// robots.txt disallows /api/ and /posting/, so this CLI never touches the JSON
// API — it reads /pl (search) and /job/<slug> (detail), which carry no
// Disallow rule.

export const BASE = "https://nofluffjobs.com"
export const SEARCH_PATH = "/pl"
export const DETAIL_PATH = "/job"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; nofluffjobs-search-cli/1.0)"

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
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  salary: SalaryBand | null
  tags: string[]
  extraLocations: number
}

export interface JobDetail extends JobCard {
  salaryBands: SalaryBand[]
  deadline: string | null
  description: string | null
  requirements: string | null
  tasks: string | null
  employmentType: string | null
  street: string | null
  country: string | null
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&minus;/g, "-")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c: string) => String.fromCodePoint(parseInt(c, 16)))
    .replace(/&#(\d+);/g, (_, c: string) => String.fromCodePoint(parseInt(c, 10)))
    .replace(/\u00a0/g, " ")
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*li[^>]*>/gi, "\n- ")
      .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6]|\/section)\s*\/?>/gi, "\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Text of the first element carrying `data-cy="<name>"`, up to its closing tag. */
export function textAfterDataCy(chunk: string, name: string): string | null {
  const re = new RegExp(`data-cy="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]*)`, "i")
  const m = re.exec(chunk)
  if (!m) return null
  const text = decodeEntities(m[1]!).replace(/\s+/g, " ").trim()
  return text === "" ? null : text
}

/**
 * Readable text of the element matched by `startRe`, up to `closeTag`.
 *
 * Several card fields (company, city) put an <inline-icon> SVG before their text,
 * so "the characters right after the opening tag" is an empty string for them —
 * the element's whole inner HTML has to be stripped instead.
 */
export function innerText(chunk: string, startRe: RegExp, closeTag: string): string | null {
  const m = startRe.exec(chunk)
  if (!m) return null
  const from = m.index + m[0].length
  const end = chunk.indexOf(closeTag, from)
  const inner = chunk.slice(from, end === -1 ? Math.min(chunk.length, from + 4000) : end)
  const text = stripHtml(inner).replace(/\s+/g, " ").trim()
  return text === "" ? null : text
}

export function allTextAfterDataCy(chunk: string, name: string): string[] {
  const re = new RegExp(`data-cy="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]*)`, "gi")
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(chunk)) !== null) {
    const text = decodeEntities(m[1]!).replace(/\s+/g, " ").trim()
    if (text !== "") out.push(text)
  }
  return out
}

/**
 * "900 – 1 100 PLN / day" / "80 – 130 PLN / h" / "18 000 PLN / mth" -> a band.
 * Returns null when the offer shows no rate (rare on this portal, which requires
 * salary disclosure, but promoted and external listings can omit it).
 */
const CURRENCY_RE = /\b(PLN|EUR|USD|GBP|CHF|CZK|HUF|SEK|NOK|DKK)\b/i

/**
 * "900", "1 100", "18 000", "1.5M", "120" -> a number.
 *
 * The portal abbreviates large amounts ("1.5M - 2.5M HUF"), so a dot or comma
 * next to a K/M suffix is a decimal point, while on its own it is a thousands
 * separator ("18.000"). Reading "1.5M" as 1 silently understates a salary by six
 * orders of magnitude, which is worse than reporting none.
 */
export function parseAmount(token: string): number | null {
  const m = /(\d[\d\s\u00a0.,]*)\s*([KkMm])?/.exec(token)
  if (!m) return null
  const suffix = m[2]?.toLowerCase() ?? null
  const digits = m[1]!.replace(/[\s\u00a0]/g, "")
  const normalized = suffix ? digits.replace(",", ".") : digits.replace(/[.,]/g, "")
  const n = parseFloat(normalized)
  if (!Number.isFinite(n)) return null
  const scale = suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1
  return Math.round(n * scale)
}

/**
 * "900 - 1 100 PLN / day", "80 - 130 PLN / h", "1.5M - 2.5M HUF / month" -> a band.
 * Returns null when the offer shows no rate (rare on this portal, which requires
 * salary disclosure, but promoted and external listings can omit it).
 */
export function parseSalaryText(raw: string | null): SalaryBand | null {
  if (!raw) return null
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim()
  const cur = CURRENCY_RE.exec(text)
  // Hidden-salary cards ("Sprawdzisz zarobki") carry no amount, but the contract
  // badge parseCard appends would otherwise yield the "2" in "B2B" as a rate.
  const amountPart = (cur ? text.slice(0, cur.index) : text).replace(/\bB2B\b/gi, " ")
  const numbers = amountPart
    .split(/[\u2013\u2014-]/)
    .map((t) => parseAmount(t))
    .filter((n): n is number => n !== null)
  if (numbers.length === 0) return null
  // The listing cards write "/ h"; the detail page writes "+ VAT (B2B) per hour".
  const unitRaw =
    (/\/\s*([A-Za-z\u0105-\u017c]+)/.exec(text)?.[1] ??
      /\b(?:per|za)\s+([A-Za-z\u0105-\u017c]+)/i.exec(text)?.[1] ??
      null)?.toLowerCase() ?? null
  const unit =
    unitRaw === null
      ? null
      : /^(h|hr|godz)/.test(unitRaw)
        ? "hour"
        : /^(d|day|dzie)/.test(unitRaw)
          ? "day"
          : /^(mth|mo|mies)/.test(unitRaw)
            ? "month"
            : unitRaw
  const typeRaw = /\((B2B|UoP|UZ|UD)\)/i.exec(text)?.[1]?.toLowerCase() ?? null
  return {
    type: typeRaw === "uop" ? "permanent" : typeRaw,
    from: numbers[0] ?? null,
    to: numbers.length > 1 ? numbers[numbers.length - 1]! : null,
    currency: cur?.[1]?.toUpperCase() ?? null,
    unit,
  }
}

/**
 * The posting's own content, excluding the "similar offers" list appended below
 * it. Every salary widget on a detail page belongs to that list, so parsing the
 * whole document reports other companies' pay as this posting's.
 */
export function mainRegion(html: string): string {
  const headerIdx = html.indexOf('id="posting-header"')
  const start = headerIdx === -1 ? 0 : Math.max(0, html.lastIndexOf("<", headerIdx))
  const similar = html.indexOf("<nfj-posting-similar", start)
  return html.slice(start, similar === -1 ? html.length : similar)
}

/** "Offer valid until: 06.09.2026" / "Oferta wazna do: ..." -> an ISO date. */
export function parseDeadline(html: string): string | null {
  const m = /(?:Offer valid until|Oferta wa\u017cna do)\s*:?\s*(\d{2})\.(\d{2})\.(\d{4})/i.exec(
    stripHtml(html),
  )
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/**
 * Split a results page into one chunk per posting card. Chunking means a single
 * malformed card cannot take the rest of the page down with it.
 */
export function splitCards(html: string): string[] {
  const marker = "nfj-postings-item"
  const starts: number[] = []
  let idx = html.indexOf(marker)
  while (idx !== -1) {
    starts.push(idx)
    idx = html.indexOf(marker, idx + marker.length)
  }
  const chunks: string[] = []
  for (let i = 0; i < starts.length; i++) {
    const end = starts[i + 1] ?? html.length
    const chunk = html.slice(starts[i]!, end)
    // The closing </nfj-postings-item> tag also matches the marker; only chunks
    // that actually carry an offer link are cards. The portal sometimes prefixes
    // the link with a locale segment (e.g. "/pl/job/..." instead of "/job/...").
    if (/href="\/(?:[a-z]{2}\/)?job\//.test(chunk)) chunks.push(chunk)
  }
  return chunks
}

export function parseCard(chunk: string): JobCard | null {
  const slug = /href="\/(?:[a-z]{2}\/)?job\/([^"]+)"/.exec(chunk)?.[1] ?? null
  const title = textAfterDataCy(chunk, "title position on the job offer listing")
  if (!slug || !title) return null

  // Company and salary used to sit inside dedicated custom tags
  // (<nfj-posting-item-city>, <nfj-posting-item-salary>); the portal has since
  // flattened those to plain <span>s, so the old tag-anchored patterns are tried
  // first (in case of a partial rollout) and the new plain-span ones as fallback.
  const flatCompany = /commonicon="job_offer"[\s\S]{0,400}?<span class="tw-truncate">([^<]*)<\/span>/
    .exec(chunk)?.[1]
  const company =
    innerText(chunk, /<h4[^>]*class="company-name[^"]*"[^>]*>/i, "</h4>") ??
    (flatCompany ? decodeEntities(flatCompany).replace(/\s+/g, " ").trim() || null : null)
  const locationRaw =
    innerText(
      chunk,
      /<nfj-posting-item-city[^>]*data-cy="location on the job offer listing"[^>]*>/i,
      "</nfj-posting-item-city>",
    ) ?? textAfterDataCy(chunk, "location on the job offer listing")
  const contractType = textAfterDataCy(chunk, "contract type on the job offer listing")
  const salaryBlock =
    /<nfj-posting-item-salary[\s\S]*?<\/nfj-posting-item-salary>/.exec(chunk)?.[0] ??
    /<span data-cy="salary ranges on the job offer listing"[^>]*>([\s\S]*?)<\/span>/.exec(chunk)?.[1] ??
    null

  // "Warszawa +1" means the same posting is also open in one other city.
  const extraMatch = locationRaw ? /\+\s*(\d+)\s*$/.exec(locationRaw) : null
  const location = locationRaw ? locationRaw.replace(/\+\s*\d+\s*$/, "").trim() || null : null

  return {
    id: slug,
    title,
    company,
    location,
    // Listing cards carry no publication date; `--dates`/`--jobage` fill this in
    // from each posting's detail page. Null here means "not fetched", never "old".
    date: null,
    url: `${BASE}${DETAIL_PATH}/${slug}`,
    // The contract-type badge ("B2B" / "UoP") sits in its own span now rather
    // than inline with the salary text; parseSalaryText still expects it in
    // parens, so it's reattached here.
    salary: parseSalaryText(
      salaryBlock ? `${stripHtml(salaryBlock)}${contractType ? ` (${contractType})` : ""}` : null,
    ),
    tags: allTextAfterDataCy(chunk, "category name on the job offer listing"),
    extraLocations: extraMatch ? parseInt(extraMatch[1]!, 10) : 0,
  }
}

/**
 * The part of a search page holding the query's real matches. Below them the
 * portal appends a "Mogą Cię też zainteresować" list of offers that do NOT match
 * the query (`<nfj-postings-list listname="search_extended">`, unsorted). Cards
 * from it would pass as results, push real ones past `--limit`, and burn detail
 * fetches under `--jobage`, so everything from that list onward is cut.
 */
export function mainListing(html: string): string {
  const cut = html.search(/<nfj-postings-list\b[^>]*\blistname="search_extended"/)
  return cut === -1 ? html : html.slice(0, cut)
}

export function parseCards(html: string): JobCard[] {
  const seen = new Set<string>()
  const out: JobCard[] = []
  for (const chunk of splitCards(html)) {
    const card = parseCard(chunk)
    // The portal repeats promoted offers across the page, and `?page=N` returns
    // pages 1..N accumulated, so de-duplication is load-bearing, not cosmetic.
    if (card && !seen.has(card.id)) {
      seen.add(card.id)
      out.push(card)
    }
  }
  return out
}

/** The JobPosting entry inside a detail page's JSON-LD `@graph`. */
export function parseJsonLdPosting(html: string): Record<string, unknown> | null {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b[1]!) as Record<string, unknown>
      const graph = Array.isArray(parsed["@graph"]) ? (parsed["@graph"] as Record<string, unknown>[]) : [parsed]
      const posting = graph.find((g) => g["@type"] === "JobPosting")
      if (posting) return posting
    } catch {
      // a malformed block must not hide a good one
    }
  }
  return null
}

/**
 * Readable text of a detail-page section, e.g. `posting-requirements`.
 *
 * The ids sit on plain `<div>`s (not `<section>`s), and the sections are
 * siblings, so a section runs from the end of its own opening tag to the tag
 * that carries the next `id="posting-…"`. Slicing from the id itself would leak
 * raw attribute text into the output.
 */
export function sectionText(html: string, id: string): string | null {
  const region = mainRegion(html)
  const idIdx = region.indexOf(`id="${id}"`)
  if (idIdx === -1) return null
  const openEnd = region.indexOf(">", idIdx)
  if (openEnd === -1) return null

  const nextId = /id="posting-[a-z-]+"/g
  nextId.lastIndex = openEnd
  const next = nextId.exec(region)
  const end = next ? Math.max(openEnd + 1, region.lastIndexOf("<", next.index)) : region.length

  const text = stripHtml(region.slice(openEnd + 1, end))
  return text === "" ? null : text
}

/**
 * Every salary band the posting itself advertises, in document order. A posting
 * can legitimately carry two — a B2B hourly rate and a permanent monthly one —
 * so silently keeping the first would misreport the offer.
 */
export function parseAllSalaries(html: string): SalaryBand[] {
  const region = mainRegion(html)
  const blocks = [
    ...region.matchAll(/<common-posting-salaries-list[\s\S]*?<\/common-posting-salaries-list>/g),
    ...region.matchAll(/<nfj-posting-item-salary[\s\S]*?<\/nfj-posting-item-salary>/g),
  ]
  const out: SalaryBand[] = []
  const seen = new Set<string>()
  for (const b of blocks) {
    const band = parseSalaryText(stripHtml(b[0]))
    if (!band) continue
    const key = `${band.from}-${band.to}-${band.currency}-${band.unit}-${band.type}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(band)
  }
  return out
}

export function parseJobDetail(html: string, id: string): JobDetail | null {
  if (!html) return null
  const posting = parseJsonLdPosting(html)
  const cards = parseCards(html)
  const card = cards.find((c) => c.id === id) ?? null

  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null)
  const org = (posting?.hiringOrganization ?? null) as Record<string, unknown> | null
  const place = (posting?.jobLocation ?? null) as Record<string, unknown> | null
  const address = (place?.address ?? null) as Record<string, unknown> | null
  const salaryLd = (posting?.baseSalary ?? null) as Record<string, unknown> | null
  const salaryVal = (salaryLd?.value ?? null) as Record<string, unknown> | null

  const title = str(posting?.title) ?? card?.title
  if (!title) return null

  const ldSalary: SalaryBand | null = salaryVal
    ? {
        type: null,
        from: typeof salaryVal.minValue === "number" ? salaryVal.minValue : null,
        to:
          typeof salaryVal.maxValue === "number"
            ? salaryVal.maxValue
            : typeof salaryVal.value === "number"
              ? salaryVal.value
              : null,
        currency: str(salaryLd?.currency),
        unit: str(salaryVal.unitText)?.toLowerCase() ?? null,
      }
    : null

  // The page's own salary widgets carry full ranges; JSON-LD often reports only
  // the upper bound, so the parsed widgets win when both exist.
  const bands = parseAllSalaries(html)

  // The detail page's own city widget, used when JSON-LD omits the address (the
  // similar-offers list on the page never contains the posting itself, so the
  // card fallback cannot help here).
  const pageCity = innerText(
    html,
    /<nfj-posting-item-city[^>]*data-cy="location on the job offer listing"[^>]*>/i,
    "</nfj-posting-item-city>",
  )

  return {
    id,
    title,
    company: str(org?.name) ?? card?.company ?? null,
    location: str(address?.addressLocality) ?? card?.location ?? (pageCity ? pageCity.replace(/\+\s*\d+\s*$/, "").trim() || null : null),
    date: str(posting?.datePosted),
    url: `${BASE}${DETAIL_PATH}/${id}`,
    salary: bands[0] ?? ldSalary ?? card?.salary ?? null,
    salaryBands: bands.length ? bands : ldSalary ? [ldSalary] : [],
    deadline: parseDeadline(mainRegion(html)),
    tags: card?.tags ?? [],
    extraLocations: card?.extraLocations ?? 0,
    description: sectionText(html, "posting-description") ?? (str(posting?.description) ? stripHtml(str(posting?.description)!) : null),
    requirements: sectionText(html, "posting-requirements"),
    tasks: sectionText(html, "posting-tasks"),
    employmentType: str(posting?.employmentType),
    street: str(address?.streetAddress),
    country: str(address?.addressCountry),
  }
}

/** Drop postings published more than `days` ago. Undated postings are kept. */
export function filterByAge(cards: JobCard[], days: number): JobCard[] {
  if (!Number.isFinite(days) || days <= 0) return cards
  // `date` is day-granular, so compare calendar days: a posting dated on the
  // cutoff's own day may be only hours old and must be kept. Comparing its
  // midnight against now - N*24h dropped yesterday's postings under --jobage 1.
  const cutoffDay = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  return cards.filter((c) => {
    if (!c.date || !/^\d{4}-\d{2}-\d{2}/.test(c.date)) return true
    return c.date.slice(0, 10) >= cutoffDay
  })
}

/**
 * Publication dates and the true match count, read from the search page's
 * embedded Angular state (`<script id="serverApp-state">`). Its main list carries
 * each posting's `posted` timestamp (ms) - the same day the detail page reports as
 * `datePosted` - so dates cost no extra request. `renewed` (an employer "bump") is
 * deliberately ignored. Only the top-level search result is read, never its
 * nested `additionalSearch` filler list. Missing or broken state yields nothing,
 * and callers fall back to detail pages.
 */
export function listingDates(html: string): { dates: Map<string, string>; total: number | null } {
  const dates = new Map<string, string>()
  const block = /<script id="serverApp-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (!block) return { dates, total: null }
  let state: Record<string, unknown>
  try {
    state = JSON.parse(block) as Record<string, unknown>
  } catch {
    return { dates, total: null }
  }
  let total: number | null = null
  for (const value of Object.values(state)) {
    if (!value || typeof value !== "object") continue
    const result = value as { postings?: unknown; totalCount?: unknown }
    if (!Array.isArray(result.postings)) continue
    if (typeof result.totalCount === "number") total = result.totalCount
    for (const p of result.postings as { url?: unknown; posted?: unknown }[]) {
      if (typeof p?.url !== "string" || typeof p.posted !== "number") continue
      dates.set(p.url, new Date(p.posted).toISOString().slice(0, 10))
    }
  }
  return { dates, total }
}

/** No Fluff Jobs filters through one packed `criteria` string, not separate params. */
export function buildCriteria(parts: Record<string, string | undefined>): string | null {
  const terms = Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
  return terms.length ? terms.join(" ") : null
}

export function citySlug(location: string | undefined): string | undefined {
  if (!location) return undefined
  const cleaned = location.trim().toLowerCase()
  if (cleaned === "") return undefined
  if (["remote", "zdalnie", "zdalna", "praca zdalna"].includes(cleaned)) return "remote"
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
  return `${range} ${s.currency ?? ""}${s.unit ? `/${s.unit}` : ""}`.trim()
}
