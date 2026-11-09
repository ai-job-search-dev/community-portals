// Data source: bulldogjob.pl public job pages. No authentication required.
// The site is a Next.js app: every list and detail page embeds its data as JSON in
// <script id="__NEXT_DATA__"> (props.pageProps), so we parse that JSON instead of the
// HTML markup. Listings live in pageProps.jobs; a detail page's full posting lives in
// pageProps.__APOLLO_STATE__ under a "Job:<id>" key.

export const BASE_URL = "https://bulldogjob.pl"
export const LIST_URL = `${BASE_URL}/companies/jobs`
/** The portal serves up to 50 offers per list page (perPage in its own Apollo query). */
export const PAGE_SIZE = 50

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export class PortalError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

const UA = "Mozilla/5.0 (compatible; bulldogjob-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pl,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
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


/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

/**
 * Decode HTML entities in a single pass, so `&amp;lt;` becomes the literal text
 * `&lt;` rather than being decoded a second time into `<`. Numeric references
 * are decimal (&#233;) or hexadecimal (&#xE9;); an out-of-range value is dropped
 * rather than thrown.
 */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:(amp|lt|gt|quot|apos|nbsp)|#(\d+)|#[xX]([0-9a-fA-F]+));/g, (_match, name, dec, hex) => {
    if (name) return NAMED_ENTITIES[name]!
    return numericEntity(dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16))
  })
}

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

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: string): boolean {
  for (const m of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ""
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) {
      return true
    }
  }
  return false
}

/**
 * Drop markup a browser never renders - comments (including Word's
 * conditional ones), <script>/<style>/<template> blocks, and elements marked
 * hidden - before tags are stripped. A plain tag strip keeps their text, which
 * hands the model words the posting's reader never saw. CSS-only tricks
 * (off-screen, zero font size) need a renderer and are not caught here.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  // One pass, collecting what is kept: slicing the string per hidden element
  // would make a page full of them quadratic.
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag) && !m[0].endsWith("/>")) {
      // Skip to the matching close tag, counting nested same-name elements. An
      // unclosed hidden element runs to the end: failing closed drops visible
      // text, failing open would leak the hidden text.
      const same = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
        if (s[1]) depth--
        else if (!s[0].endsWith("/>")) depth++
        if (depth === 0) {
          end = same.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    open.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

function stripTags(html: string): string {
  return visibleHtml(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}


// ---------------------------------------------------------------------------
// bulldogjob-specific parsing
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

function isObj(v: unknown): v is Json {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

/** Pull props.pageProps out of the embedded __NEXT_DATA__ JSON. Throws PARSE_FAILED if the markup changed. */
export function extractPageProps(html: string): Json {
  const open = html.indexOf('<script id="__NEXT_DATA__"')
  const start = open === -1 ? -1 : html.indexOf(">", open)
  const end = start === -1 ? -1 : html.indexOf("</script>", start)
  if (end === -1) throw new PortalError("__NEXT_DATA__ block not found - bulldogjob markup changed", "PARSE_FAILED")
  let data: unknown
  try {
    data = JSON.parse(html.slice(start + 1, end))
  } catch {
    throw new PortalError("__NEXT_DATA__ is not valid JSON - bulldogjob markup changed", "PARSE_FAILED")
  }
  const props = isObj(data) && isObj(data.props) ? data.props : null
  const pageProps = props && isObj(props.pageProps) ? props.pageProps : null
  if (!pageProps) throw new PortalError("pageProps missing from __NEXT_DATA__ - bulldogjob markup changed", "PARSE_FAILED")
  return pageProps
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  /** Publication day (YYYY-MM-DD). Null on list pages; filled by --dates / --jobage from the detail page. */
  date: string | null
  postedAt: string | null
  url: string
  remote: boolean
  level: string | null
  employmentType: string | null
  contracts: string[]
  salary: string | null
  tags: string[]
}

export const jobUrl = (id: string): string => `${LIST_URL}/${id}`

function salaryText(v: unknown, show: unknown): string | null {
  if (show === false || !isObj(v) || v.hidden === true) return null
  const money = str(v.money)
  return money ? [money, str(v.currency)].filter(Boolean).join(" ") : null
}

function contractsOf(j: Json): string[] {
  const out: string[] = []
  if (j.contractB2b === true) out.push("B2B")
  if (j.contractEmployment === true) out.push("employment")
  if (j.contractOther) out.push("other")
  return out
}

/** Parse one list-page job. Returns null when the entry lacks an id or title. */
export function parseCard(raw: unknown): JobCard | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  const title = str(raw.position)
  if (!id || !title) return null
  const remote = raw.remote === true
  const city = str(raw.city)
  return {
    id,
    title,
    company: isObj(raw.company) ? str(raw.company.name) : null,
    location: city ?? (remote ? "Remote" : null),
    date: null,
    postedAt: null,
    url: jobUrl(id),
    remote,
    level: str(raw.experienceLevel),
    employmentType: str(raw.employmentType),
    contracts: contractsOf(raw),
    salary: salaryText(raw.denominatedSalaryLong, raw.showSalary),
    tags: Array.isArray(raw.technologyTags) ? raw.technologyTags.filter((t): t is string => typeof t === "string") : [],
  }
}

/** Parse a list page: each job independently, so one malformed entry cannot break the rest. */
export function parseSearch(html: string): { total: number; cards: JobCard[] } {
  const pp = extractPageProps(html)
  const jobs = Array.isArray(pp.jobs) ? pp.jobs : null
  if (!jobs) throw new PortalError("pageProps.jobs missing - bulldogjob markup changed", "PARSE_FAILED")
  const cards: JobCard[] = []
  for (const raw of jobs) {
    try {
      const card = parseCard(raw)
      if (card) cards.push(card)
    } catch {
      // skip the malformed entry
    }
  }
  const total = typeof pp.totalCount === "number" ? pp.totalCount : cards.length
  return { total, cards }
}

export interface JobDetail extends JobCard {
  description: string | null
  deadline: string | null
  workModes: string[]
  workFrom: string[]
  locations: string[]
  minExperienceYears: number | null
  isActive: boolean
}

/** HTML fragment -> readable text, paragraph/list breaks kept as newlines. */
export function htmlToText(html: string): string {
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|ul|ol|div|h\d|tr)>/gi, "\n")
  return withBreaks.split("\n").map(clean).join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function salaryDetail(j: Json): string | null {
  for (const key of ["b2bSalary", "employmentSalary", "otherSalary"]) {
    const v = j[key]
    if (isObj(v) && v.hidden !== true) {
      const money = str(v.money)
      if (money) {
        const label = key === "b2bSalary" ? "B2B" : key === "employmentSalary" ? "employment" : "other"
        return `${money} ${str(v.currency) ?? ""}`.trim() + ` (${label})`
      }
    }
  }
  return null
}

/** Parse a detail page from its Apollo state. Throws PARSE_FAILED when no Job entry is present. */
export function parseDetail(html: string, id: string): JobDetail {
  const pp = extractPageProps(html)
  const apollo = isObj(pp.__APOLLO_STATE__) ? pp.__APOLLO_STATE__ : null
  const key = apollo ? Object.keys(apollo).find((k) => k.startsWith("Job:")) : undefined
  const job = apollo && key && isObj(apollo[key]) ? (apollo[key] as Json) : null
  if (!apollo || !job) throw new PortalError("Job entry missing from detail page - bulldogjob markup changed", "PARSE_FAILED")

  const companyRef = isObj(job.company) ? str(job.company.__ref) : null
  const companyObj = companyRef && isObj(apollo[companyRef]) ? (apollo[companyRef] as Json) : null
  const company = companyObj ? str(companyObj.name) : null

  const locations: string[] = []
  if (Array.isArray(job.locations)) {
    for (const l of job.locations) {
      const loc = isObj(l) && isObj(l.location) ? l.location : null
      const city = loc ? (str(loc.cityEn) ?? str(loc.cityPl)) : null
      if (city && !locations.includes(city)) locations.push(city)
    }
  }
  const workModes = Array.isArray(job.workModes) ? job.workModes.filter((x): x is string => typeof x === "string") : []
  const remote = job.remote === true || workModes.includes("full-remote") || workModes.includes("remote")

  const parts: string[] = []
  const salary = salaryDetail(job)
  for (const field of ["details", "requirements", "offer"]) {
    const v = str(job[field])
    if (v) parts.push(htmlToText(v))
  }
  const description = parts.filter(Boolean).join("\n\n") || null

  const published = str(job.publishedAt)
  const ends = str(job.endsAt)
  const date = published ? published.slice(0, 10) : null
  const endsMs = ends ? Date.parse(ends) : NaN
  const isActive = str(job.state) === "published" && !(Number.isFinite(endsMs) && endsMs < Date.now())
  const jobId = str(job.id) ?? id

  return {
    id: jobId,
    title: str(job.position) ?? "(untitled)",
    company,
    location: locations.length ? locations.join(", ") : remote ? "Remote" : null,
    date,
    postedAt: published && Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : null,
    url: jobUrl(jobId),
    remote,
    level: str(job.experienceLevel),
    employmentType: str(job.employmentType),
    contracts: contractsOf(job),
    salary,
    tags: Array.isArray(job.technologyTags) ? job.technologyTags.filter((t): t is string => typeof t === "string") : [],
    description,
    deadline: ends ? ends.slice(0, 10) : null,
    workModes,
    workFrom: Array.isArray(job.workFrom) ? job.workFrom.filter((x): x is string => typeof x === "string") : [],
    locations,
    minExperienceYears: typeof job.minExperienceInYears === "number" ? job.minExperienceInYears : null,
    isActive,
  }
}

// ---------------------------------------------------------------------------
// Filters -> list URL
// ---------------------------------------------------------------------------

/** City slugs the portal's own city filter offers (pageProps.jobsLocations). "Remote" is one of them. */
export const CITIES = [
  "Remote", "Warszawa", "Kraków", "Wrocław", "Gdańsk", "Łódź", "Poznań", "Katowice", "Białystok", "Rzeszów", "Lublin",
]
export const LEVELS = ["junior", "medium", "senior", "lead"]

const fold = (s: string): string =>
  s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "")

/** Case- and diacritic-insensitive city match ("krakow" -> "Kraków"); null when the portal has no such city filter. */
export function normalizeCity(input: string): string | null {
  return CITIES.find((c) => fold(c) === fold(input.trim())) ?? null
}

export interface ListFilters {
  skill?: string
  role?: string
  level?: string
  city?: string
  page?: number
}

/** Build the list URL: filters are path segments of the form /<key>,<value>. */
export function buildListUrl(f: ListFilters): string {
  const seg: string[] = []
  const add = (k: string, v: string | undefined) => {
    if (v) seg.push(`${k},${encodeURIComponent(v)}`)
  }
  add("skills", f.skill)
  add("role", f.role)
  add("experienceLevel", f.level)
  add("city", f.city)
  if (f.page && f.page > 1) add("page", String(f.page))
  return seg.length ? `${LIST_URL}/s/${seg.join("/")}` : LIST_URL
}
