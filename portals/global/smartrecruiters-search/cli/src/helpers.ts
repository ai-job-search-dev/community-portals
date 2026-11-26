// Data source: SmartRecruiters' public Posting API
// (api.smartrecruiters.com/v1/companies/<slug>/postings), the JSON feed
// SmartRecruiters careers sites are built on. The Customer API overview lists
// the Posting API as available without authentication; no API key is needed for
// these public postings. Boards are per company (the slug in
// jobs.smartrecruiters.com/<slug>), and the list endpoint pages with
// limit/offset and accepts a keyword query, so searching is server-side.

export const API_BASE = "https://api.smartrecruiters.com/v1/companies"
export const POSTING_HOST = "https://jobs.smartrecruiters.com"

/** Page size this CLI asks for; the API caps `limit` at 100. */
export const PAGE_SIZE = 20

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "smartrecruiters-cli/1.0"

/** Retry policy for jsonFetch; tests pass a fast one. */
export interface RetryPolicy {
  maxRetries: number
  baseDelayMs: number
}
const DEFAULT_RETRY: RetryPolicy = { maxRetries: 6, baseDelayMs: 500 }

/**
 * Retry-After is either a number of seconds or an HTTP-date. Returns the wait
 * in milliseconds, or null when the header is absent or unreadable.
 */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const value = header.trim()
  const seconds = Number(value)
  // Zero is valid ("retry immediately"); a negative delay is not.
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null
  const at = Date.parse(value)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - now)
}

/** The Customer API overview asks clients to allow at least 128 s for a response. */
const REQUEST_TIMEOUT_MS = 128_000

/** Fetch JSON, backing off on 429/5xx (Retry-After when sent, else exponential with jitter). Returns null on a 404. */
export async function jsonFetch<T = unknown>(url: string, retry: RetryPolicy = DEFAULT_RETRY): Promise<T | null> {
  const { maxRetries } = retry
  let delay = retry.baseDelayMs
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      // Honor Retry-After (seconds or HTTP-date, capped at 30 s); otherwise back off exponentially.
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"))
      const wait = retryAfter !== null ? Math.min(retryAfter, 30000) : Math.min(delay + Math.floor(Math.random() * delay), 8000)
      await new Promise((r) => setTimeout(r, wait))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
  }
  throw new Error("Request failed after max retries")
}

/** `/departments` is a keyless Common Elements endpoint; a 404 means the company identifier is unknown. */
export async function boardExists(board: string): Promise<boolean> {
  return (await jsonFetch<unknown>(`${API_BASE}/${board}/departments`)) !== null
}

// ---------------------------------------------------------------------------
// Board slugs and job references
// ---------------------------------------------------------------------------

const BOARD_RE = /^[A-Za-z0-9._-]{1,100}$/

/** A board slug is a URL path segment; anything else is rejected rather than encoded. */
export function isValidBoard(board: string): boolean {
  return BOARD_RE.test(board) && board !== "." && board !== ".."
}

const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/

export function isJobId(id: string): boolean {
  return JOB_ID_RE.test(id)
}

/**
 * Resolve `--board` to the company identifier. Accepts a bare slug
 * (`BoschGroup`), a careers or jobs URL (`https://jobs.smartrecruiters.com/<slug>`,
 * `https://careers.smartrecruiters.com/<slug>`), a posting URL, or the API URL.
 * Hosts are compared exactly after real URL parsing, so look-alikes are rejected.
 */
export function parseBoard(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (!/[/:?#\s]/.test(trimmed)) return isValidBoard(trimmed) ? trimmed : null

  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return null
  const host = parsed.hostname.toLowerCase()
  const segments = parsed.pathname.split("/").filter(Boolean)

  if (host === "api.smartrecruiters.com") {
    // /v1/companies/<slug>[/postings[/<id>]]
    if (segments[0] === "v1" && segments[1] === "companies" && segments[2]) {
      return isValidBoard(segments[2]) ? segments[2] : null
    }
    return null
  }
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
    return segments[0] && isValidBoard(segments[0]) ? segments[0] : null
  }
  return null
}

export interface JobRef {
  board: string
  id: string
}

/**
 * Resolve a detail argument to { board, id }.
 *
 * Accepts a bare posting id with --board, or a SmartRecruiters URL:
 *   jobs.smartrecruiters.com/<slug>/<id>[-<title>]
 *   careers.smartrecruiters.com/<slug>/<id>[-<title>]
 *   api.smartrecruiters.com/v1/companies/<slug>/postings/<id>
 * Hosts are compared exactly after real URL parsing, so look-alikes
 * (jobs.smartrecruiters.com.evil.com, smartrecruiters.com@evil.com) are rejected.
 * Query strings and fragments are ignored.
 */
export function parseJobRef(input: string, board?: string): JobRef | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (!/[/:?#\s]/.test(trimmed)) {
    if (!isJobId(trimmed) || !board || !isValidBoard(board)) return null
    return { board, id: trimmed }
  }

  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return null
  const host = parsed.hostname.toLowerCase()
  const segments = parsed.pathname.split("/").filter(Boolean)

  let urlBoard: string | undefined
  let rawId: string | undefined
  if (host === "api.smartrecruiters.com") {
    // /v1/companies/<slug>/postings/<id>
    if (segments.length === 5 && segments[0] === "v1" && segments[1] === "companies" && segments[3] === "postings") {
      urlBoard = segments[2]
      rawId = segments[4]
    }
  } else if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
    // /<slug>/<id>[-<title>]; the id may also be a UUID followed by a title slug.
    if (segments.length === 2) {
      urlBoard = segments[0]
      const uuid = segments[1].match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-|$)/i)
      rawId = uuid ? uuid[1] : segments[1].split("-")[0]
    }
  }
  if (!urlBoard || !rawId) return null
  if (!isValidBoard(urlBoard) || !isJobId(rawId)) return null
  if (board !== undefined && board !== urlBoard) return null
  return { board: urlBoard, id: rawId }
}

// ---------------------------------------------------------------------------
// Text hygiene (kept in step with community-portals workable-search helpers.ts)
// ---------------------------------------------------------------------------

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

// Named entities seen in ATS-authored posting HTML. Anything not listed is left
// as-is (visible, so a gap shows up in review rather than silently vanishing).
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ensp: " ", emsp: " ", thinsp: " ",
  mdash: "—", ndash: "–", hellip: "…", minus: "−",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", bull: "•", middot: "·",
  trade: "™", reg: "®", copy: "©", deg: "°", times: "×",
  euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶",
  colon: ":", semi: ";",
}

/**
 * Decode one layer of HTML entities in a single pass. Single-pass matters:
 * "&amp;lt;" must become the literal text "&lt;", never "<".
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, name: string) => {
    if (name[0] === "#") {
      const hex = name[1] === "x" || name[1] === "X"
      return numericEntity(parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10))
    }
    for (const key of [name, name.toLowerCase()]) {
      if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)) return NAMED_ENTITIES[key]
    }
    return whole
  })
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F).
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

// Quoted attribute values may hold `>` or a close-tag string; neither ends the tag.
const ATTRS = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: string): boolean {
  for (const m of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase()
    // A browser decodes character references in attribute values, so
    // `style="display&#58;none"` hides the element too.
    const value = decodeHtmlEntities(m[2] ?? m[3] ?? m[4] ?? "")
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
  const open = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)(\\s${ATTRS})?>`, "g")
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag)) {
      // Skip to the matching close tag, counting nested same-name elements. An
      // unclosed hidden element runs to the end: failing closed drops visible
      // text, failing open would leak the hidden text.
      const same = new RegExp(`<(/?)([a-zA-Z][a-zA-Z0-9-]*)${ATTRS}>`, "g")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
        if (s[2].toLowerCase() !== tag) continue
        if (s[1]) depth--
        else depth++
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

function cleanLine(html: string): string {
  return decodeHtmlEntities(html.replace(new RegExp(`<${ATTRS}>`, "g"), " ")).replace(/[ \t ]+/g, " ").trim()
}

/** Convert a posting section's HTML to readable text, keeping paragraph and list breaks. */
export function htmlToText(html: string): string {
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr|table)>/gi, "\n")
  return withBreaks
    .split("\n")
    .map(cleanLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(- )?\n/gm, "")
    .trim()
}

// ---------------------------------------------------------------------------
// API shapes and mapping
// ---------------------------------------------------------------------------

export interface ApiLocation {
  city?: string | null
  region?: string | null
  country?: string | null
  remote?: boolean | null
  hybrid?: boolean | null
  fullLocation?: string | null
}

interface ApiLabel {
  id?: string | null
  label?: string | null
}

export interface ApiPosting {
  id?: string | null
  uuid?: string | null
  name?: string | null
  refNumber?: string | null
  releasedDate?: string | null
  unpublishOn?: string | null
  visibility?: string | null
  company?: { identifier?: string | null; name?: string | null } | null
  location?: ApiLocation | null
  department?: ApiLabel | null
  function?: ApiLabel | null
  industry?: ApiLabel | null
  typeOfEmployment?: ApiLabel | null
  experienceLevel?: ApiLabel | null
  language?: { code?: string | null } | null
}

export interface ApiPostingList {
  offset?: number | null
  limit?: number | null
  totalFound?: number | null
  content?: ApiPosting[] | null
}

/** The public feed only serves public postings; keep the same guard in search and detail. */
export function isPublicPosting(posting: Pick<ApiPosting, "visibility">): boolean {
  return posting.visibility == null || posting.visibility === "PUBLIC"
}

export interface ApiSection {
  title?: string | null
  text?: string | null
}

export interface ApiCompensation {
  min?: number | null
  max?: number | null
  currency?: string | null
  period?: string | null
}

export const REMOTE_MODES = ["remote", "hybrid", "onsite"] as const
export type RemoteMode = (typeof REMOTE_MODES)[number]

/**
 * Parse `--remote`: a bare flag means remote, comma-separated values are OR,
 * and `on-site` is normalised to `onsite`. Returns `bad` for an unknown item.
 */
export function parseRemoteModes(raw: unknown): { value?: string; bad?: string } {
  if (raw === undefined) return {}
  if (raw === true) return { value: "remote" }
  if (typeof raw !== "string" || !raw.trim()) return { bad: String(raw) }
  const modes: RemoteMode[] = []
  for (const item of raw.split(",")) {
    const token = item.trim().toLowerCase()
    if (!token) continue
    if (token === "remote" || token === "hybrid" || token === "onsite") {
      modes.push(token)
    } else if (token === "on-site") {
      modes.push("onsite")
    } else {
      return { bad: item.trim() }
    }
  }
  return modes.length > 0 ? { value: modes.join(",") } : { bad: raw.trim() }
}

export interface ApiDetail extends ApiPosting {
  active?: boolean | null
  applyUrl?: string | null
  postingUrl?: string | null
  compensation?: ApiCompensation | null
  jobAd?: { sections?: Record<string, ApiSection | null | undefined> | null } | null
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  deadline: string | null
  url: string
  board: string
  department: string | null
  function: string | null
  industry: string | null
  employmentType: string | null
  experienceLevel: string | null
  requisitionId: string | null
  language: string | null
}

export interface Compensation {
  min: number | null
  max: number | null
  currency: string | null
  period: string | null
}

export interface JobDetail extends JobCard {
  active: boolean
  applyUrl: string | null
  compensation: Compensation | null
  description: string | null
  qualifications: string | null
  additionalInformation: string | null
  companyDescription: string | null
}

let regionNames: Intl.DisplayNames | null | undefined

function regionDisplayNames(): Intl.DisplayNames | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" })
    } catch {
      regionNames = null
    }
  }
  return regionNames
}

/** Expand a two-letter country code to its English name; keep the code when that is all we have. */
function countryLabel(country: string): string {
  if (!/^[a-z]{2}$/i.test(country)) return country
  try {
    const name = regionDisplayNames()?.of(country.toUpperCase())
    if (name && name !== "Unknown Region" && name.toUpperCase() !== country.toUpperCase()) return name
  } catch {
    // Intl.DisplayNames can reject an unsupported locale; the code is honest.
  }
  return country
}

/** "Batu Kawan, Penang, Malaysia · Remote"; `fullLocation` when the API sends one. */
export function locationLine(loc: ApiLocation | null | undefined): string {
  if (!loc) return ""
  const full = typeof loc.fullLocation === "string" ? loc.fullLocation.trim() : ""
  const parts: string[] = []
  if (full) {
    parts.push(full)
  } else {
    const city = typeof loc.city === "string" ? loc.city.trim() : ""
    const region = typeof loc.region === "string" ? loc.region.trim() : ""
    const country = typeof loc.country === "string" ? loc.country.trim() : ""
    if (city) parts.push(city)
    else if (region) parts.push(region)
    if (city && region && region.toLowerCase() !== city.toLowerCase()) parts.push(region)
    if (country) parts.push(countryLabel(country))
  }
  if (loc.remote && !parts.some((p) => /remote/i.test(p))) parts.push("Remote")
  if (loc.hybrid && !parts.some((p) => /hybrid/i.test(p))) parts.push("Hybrid")
  return parts.join(", ")
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

/** The public posting URL. SmartRecruiters resolves it by id alone; the title slug is cosmetic. */
export function postingUrl(board: string, id: string, title = ""): string {
  const suffix = slugify(title)
  return `${POSTING_HOST}/${board}/${id}${suffix ? `-${suffix}` : ""}`
}

/** Trust a payload's postingUrl only when it is a jobs.smartrecruiters.com URL. */
function trustedPostingUrl(raw: string | null | undefined, board: string, id: string, title: string): string {
  if (typeof raw === "string") {
    try {
      const parsed = new URL(raw)
      if (parsed.protocol === "https:" && parsed.hostname.toLowerCase() === "jobs.smartrecruiters.com") return raw
    } catch {
      // fall through to the built URL
    }
  }
  return postingUrl(board, id, title)
}

/** Emit application URLs only when they are ordinary web URLs, never javascript: or data:. */
function safeApplyUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  const value = raw.trim()
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null
  } catch {
    return null
  }
}

function label(value: ApiLabel | null | undefined): string | null {
  return typeof value?.label === "string" && value.label.trim() ? value.label.trim() : null
}

/**
 * SmartRecruiters labels a student role "Full-time" while `experienceLevel.id`
 * is `internship`; that level decides, as it does in the upstream provider.
 */
export function employmentLabel(posting: ApiPosting): string | null {
  if (posting.experienceLevel?.id === "internship") return "Internship"
  return label(posting.typeOfEmployment)
}

export function toCard(raw: ApiPosting, board: string): JobCard {
  const id = typeof raw.id === "string" ? raw.id.trim() : ""
  const title = typeof raw.name === "string" ? raw.name.trim() : ""
  return {
    id,
    title: title || "(untitled)",
    company: raw.company?.name?.trim() || board,
    location: locationLine(raw.location) || null,
    date: raw.releasedDate ?? null,
    deadline: typeof raw.unpublishOn === "string" && raw.unpublishOn.trim() ? raw.unpublishOn.trim() : null,
    url: postingUrl(board, id, title),
    board,
    department: label(raw.department),
    function: label(raw.function),
    industry: label(raw.industry),
    employmentType: employmentLabel(raw),
    experienceLevel: label(raw.experienceLevel),
    requisitionId: typeof raw.refNumber === "string" ? raw.refNumber.trim() || null : null,
    language: typeof raw.language?.code === "string" ? raw.language.code.trim() || null : null,
  }
}

function sectionText(sections: Record<string, ApiSection | null | undefined> | null | undefined, key: string): string | null {
  const html = sections?.[key]?.text
  return typeof html === "string" && html.trim() ? htmlToText(html) || null : null
}

function compensation(raw: ApiCompensation | null | undefined): Compensation | null {
  if (!raw || typeof raw !== "object") return null
  const value: Compensation = {
    min: typeof raw.min === "number" ? raw.min : null,
    max: typeof raw.max === "number" ? raw.max : null,
    currency: typeof raw.currency === "string" && raw.currency.trim() ? raw.currency.trim() : null,
    period: typeof raw.period === "string" && raw.period.trim() ? raw.period.trim() : null,
  }
  return value.min !== null || value.max !== null || value.currency !== null || value.period !== null ? value : null
}

export function toDetail(raw: ApiDetail, board: string): JobDetail {
  const card = toCard(raw, board)
  const sections = raw.jobAd?.sections
  return {
    ...card,
    url: trustedPostingUrl(raw.postingUrl, board, card.id, card.title),
    active: raw.active !== false,
    applyUrl: safeApplyUrl(raw.applyUrl),
    compensation: compensation(raw.compensation),
    description: sectionText(sections, "jobDescription"),
    qualifications: sectionText(sections, "qualifications"),
    additionalInformation: sectionText(sections, "additionalInformation"),
    companyDescription: sectionText(sections, "companyDescription"),
  }
}

// ---------------------------------------------------------------------------
// Client-side filters (the board's own keyword search handles --query)
// ---------------------------------------------------------------------------

/** Case-insensitive substring match on the joined location string. */
export function matchesLocation(location: string | null, wanted: string | undefined): boolean {
  if (!wanted) return true
  return (location ?? "").toLowerCase().includes(wanted.toLowerCase())
}

/** Clock-skew allowance for a publish date slightly ahead of this machine's clock. */
const FUTURE_SKEW_MS = 60 * 60 * 1000

/**
 * Posted within N days, judged by `releasedDate`. A date further in the future
 * than the skew allowance fails, rather than passing every cutoff with a
 * negative age.
 */
export function withinDays(date: string | null, days: number | undefined, now = Date.now()): boolean {
  if (!days) return true
  if (!date) return false
  const t = Date.parse(date)
  if (Number.isNaN(t)) return false
  const age = now - t
  return age >= -FUTURE_SKEW_MS && age <= days * 86400000
}
