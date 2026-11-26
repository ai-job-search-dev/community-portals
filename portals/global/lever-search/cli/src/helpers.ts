// Data source: Lever's public Postings API (api.lever.co/v0/postings/<slug>),
// the endpoint Lever publishes for career sites to read their own job boards.
// No authentication required for GET requests. Boards are per company (the
// slug in jobs.lever.co/<slug>), and every posting carries its full description
// in the board response, so filtering and paging are client-side. The board
// endpoint pages with limit/skip, which is used to keep large boards bounded.

export const API_HOSTS = {
  us: "https://api.lever.co/v0/postings",
  eu: "https://api.eu.lever.co/v0/postings",
} as const
export type Region = keyof typeof API_HOSTS
export type Workplace = "remote" | "hybrid" | "onsite"

/** Human-facing board hosts, used only to build a fallback URL when the API omits one. */
export const POSTING_HOSTS = {
  us: "https://jobs.lever.co",
  eu: "https://jobs.eu.lever.co",
} as const

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; lever-cli/1.0)"

/** Retry policy for jsonFetch; tests pass a fast one. */
export interface RetryPolicy {
  maxRetries: number
  baseDelayMs: number
}
const DEFAULT_RETRY: RetryPolicy = { maxRetries: 6, baseDelayMs: 1000 }
/** Never retry faster than the API's robots.txt Crawl-delay: 1. */
const MIN_RETRY_DELAY_MS = 1000

/**
 * `Retry-After` is either delta-seconds or an HTTP-date (RFC 9110). Returns the
 * raw delay in milliseconds, or null when the header is absent or unparseable.
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (typeof value !== "string" || !value.trim()) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - now)
}

/** Fetch JSON, backing off on 429/5xx (Retry-After when sent, else exponential with jitter). Returns null on a 404. */
export async function jsonFetch<T = unknown>(url: string, retry: RetryPolicy = DEFAULT_RETRY): Promise<T | null> {
  const { maxRetries } = retry
  let delay = retry.baseDelayMs
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      // Honor Retry-After (seconds or an HTTP-date, capped at 30 s) but never
      // retry faster than the crawl delay; otherwise back off exponentially.
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"))
      const wait = retryAfter !== null
        ? Math.min(Math.max(retryAfter, MIN_RETRY_DELAY_MS), 30000)
        : Math.min(Math.max(delay + Math.floor(Math.random() * delay), MIN_RETRY_DELAY_MS), 8000)
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

// ---------------------------------------------------------------------------
// Board slugs and job references
// ---------------------------------------------------------------------------

const BOARD_RE = /^[A-Za-z0-9._-]{1,100}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A board slug is a URL path segment; anything else is rejected rather than encoded. */
export function isValidBoard(board: string): boolean {
  return BOARD_RE.test(board) && board !== "." && board !== ".."
}

export function isJobId(id: string): boolean {
  return UUID_RE.test(id)
}

const HOST_REGION: Record<string, Region> = {
  "jobs.lever.co": "us",
  "api.lever.co": "us",
  "jobs.eu.lever.co": "eu",
  "api.eu.lever.co": "eu",
}

export interface JobRef {
  board: string
  id: string
  region: Region
}

/**
 * Resolve a detail argument to { board, id, region }.
 *
 * Accepts a Lever posting UUID (board then comes from --board), or a Lever URL:
 * jobs[.eu].lever.co/<board>/<uuid>[/apply], or the API form
 * api[.eu].lever.co/v0/postings/<board>/<uuid>. Hosts are compared exactly after
 * real URL parsing, so look-alikes (jobs.lever.co.evil.com, evil-lever.co) and
 * userinfo tricks are rejected.
 */
export function parseJobRef(input: string, board?: string, region: Region = "us"): JobRef | null {
  const trimmed = input.trim()
  if (isJobId(trimmed)) {
    if (!board || !isValidBoard(board)) return null
    return { board, id: trimmed.toLowerCase(), region }
  }

  const hasScheme = /^https?:\/\//i.test(trimmed)
  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return null
  const host = parsed.hostname.toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(HOST_REGION, host)) return null
  const urlRegion = HOST_REGION[host]

  const path = parsed.pathname.match(/^\/(?:v0\/postings\/)?([^/]+)\/([0-9a-f-]{36})(?:\/apply)?\/?$/i)
  if (!path) return null
  let urlBoard: string
  try {
    urlBoard = decodeURIComponent(path[1])
  } catch {
    return null // malformed percent-encoding
  }
  if (!isValidBoard(urlBoard) || !isJobId(path[2])) return null
  if (board && board !== urlBoard) return null
  return { board: urlBoard, id: path[2].toLowerCase(), region: urlRegion }
}

// ---------------------------------------------------------------------------
// Text hygiene (kept in step with community-portals greenhouse-search helpers.ts)
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
      // Every tag is matched whole, so a close tag inside a quoted attribute is skipped.
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

/** Convert posting HTML to readable text, keeping paragraph and list breaks. */
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

export interface ApiList {
  text?: string | null
  content?: string | null
}

export interface ApiSalaryRange {
  min?: number | null
  max?: number | null
  currency?: string | null
  interval?: string | null
}

export interface ApiJob {
  id: string
  text?: string | null
  hostedUrl?: string | null
  applyUrl?: string | null
  createdAt?: number | null
  categories?: {
    location?: string | null
    allLocations?: string[] | null
    department?: string | null
    team?: string | null
    commitment?: string | null
  } | null
  workplaceType?: string | null
  country?: string | null
  description?: string | null
  descriptionPlain?: string | null
  lists?: ApiList[] | null
  additional?: string | null
  additionalPlain?: string | null
  salaryRange?: ApiSalaryRange | null
}

export interface JobCard {
  id: string
  title: string
  company: string
  location: string | null
  date: string | null
  url: string
  board: string
  workplace: string | null
  department: string | null
}

export interface SalaryRange {
  min: number
  max: number
  currency: string
  interval: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  team: string | null
  employmentType: string | null
  country: string | null
  salary: SalaryRange | null
  applyUrl: string | null
}

const REMOTE_WORD_RE = /(?<![\p{L}\p{M}\p{N}])remote(?![\p{L}\p{M}\p{N}])/iu

/**
 * Lever puts one primary city in `categories.location` and the full set in
 * `categories.allLocations`, so reading only the former hides every other
 * eligible location. `workplaceType: "remote"` is a posting flag, not a
 * location: append "Remote" once when no segment already says it.
 */
export function resolveLocation(categories: ApiJob["categories"], workplaceType?: string | null): string | null {
  const primary = typeof categories?.location === "string" ? categories.location.trim() : ""
  const all = Array.isArray(categories?.allLocations)
    ? categories.allLocations.filter((l): l is string => typeof l === "string" && !!l.trim()).map((l) => l.trim())
    : []
  const merged: string[] = []
  for (const l of [primary, ...all]) {
    if (l && !merged.some((m) => m.toLowerCase() === l.toLowerCase())) merged.push(l)
  }
  const remote = typeof workplaceType === "string" && workplaceType.trim().toLowerCase() === "remote"
  if (remote && !merged.some((m) => REMOTE_WORD_RE.test(m))) merged.push("Remote")
  return merged.length ? merged.join("; ") : null
}

/** Lever's createdAt is epoch milliseconds; ISO 8601 out, null when unusable. */
export function isoDate(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** An absolute http(s) link, or null: API URL fields are untrusted strings. */
function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

export function toCard(job: ApiJob, board: string, region: Region = "us"): JobCard {
  return {
    id: job.id,
    title: (job.text ?? "").trim() || "(untitled)",
    // Lever's payload carries no company display name, so the board slug is the
    // honest identifier here (unlike Greenhouse's company_name).
    company: board,
    location: resolveLocation(job.categories, job.workplaceType),
    date: isoDate(job.createdAt),
    url: safeHttpUrl(job.hostedUrl) ?? `${POSTING_HOSTS[region]}/${board}/${job.id}`,
    board,
    workplace: job.workplaceType?.trim() || null,
    department: job.categories?.department?.trim() || null,
  }
}

/** The three description parts Lever ships separately, in page order. */
export function leverDescription(job: ApiJob): string {
  const intro = job.description?.trim() ? htmlToText(job.description) : (job.descriptionPlain ?? "").trim()
  const lists = (job.lists ?? [])
    .map((l) => [cleanLine(l.text ?? ""), htmlToText(l.content ?? "")].filter(Boolean).join("\n"))
    .filter(Boolean)
  const extra = job.additional?.trim() ? htmlToText(job.additional) : (job.additionalPlain ?? "").trim()
  return [intro, ...lists, extra].filter(Boolean).join("\n\n")
}

/** A usable pay range, or null when the employer published none. */
export function toSalary(range: ApiSalaryRange | null | undefined): SalaryRange | null {
  if (!range) return null
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null
  const min = num(range.min)
  const max = num(range.max)
  if (min === null && max === null) return null
  const a = (min ?? max) as number
  const b = (max ?? min) as number
  return {
    min: Math.min(a, b),
    max: Math.max(a, b),
    currency: typeof range.currency === "string" ? range.currency.trim().toUpperCase() : "",
    interval: typeof range.interval === "string" && range.interval.trim() ? range.interval.trim() : null,
  }
}

export function toDetail(job: ApiJob, board: string, region: Region = "us"): JobDetail {
  return {
    ...toCard(job, board, region),
    description: leverDescription(job) || null,
    team: job.categories?.team?.trim() || null,
    employmentType: job.categories?.commitment?.trim() || null,
    country: job.country?.trim() || null,
    salary: toSalary(job.salaryRange),
    applyUrl: safeHttpUrl(job.applyUrl),
  }
}

// ---------------------------------------------------------------------------
// Board and posting fetches
// ---------------------------------------------------------------------------

/** Lever's board endpoint pages with limit/skip; 100 keeps one response small. */
export const FETCH_PAGE_SIZE = 100
/** Runaway guard: 20,000 postings is far beyond any real board. */
const MAX_PAGES = 200
/** Match the API's robots.txt Crawl-delay: 1. */
const PAGE_GAP_MS = 1000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetch every posting on a board as small cards, paging with limit/skip. Null
 * when the board is unknown (404). Lever inlines full descriptions in the board
 * response; mapping each page keeps only the card fields a search needs.
 */
export async function fetchBoard(board: string, region: Region, retry?: RetryPolicy): Promise<JobCard[] | null> {
  const all: JobCard[] = []
  const maxPostings = MAX_PAGES * FETCH_PAGE_SIZE
  const tooMany = () => new Error(`Board "${board}" returned more than ${maxPostings} postings; refusing to read further`)
  for (let page = 0; ; page++) {
    if (page > MAX_PAGES) throw tooMany()
    if (page > 0) await sleep(PAGE_GAP_MS)
    const url = `${API_HOSTS[region]}/${board}?mode=json&limit=${FETCH_PAGE_SIZE}&skip=${all.length}`
    const data = await jsonFetch<ApiJob[]>(url, retry)
    if (data === null) {
      if (all.length === 0) return null
      throw new Error(`Board "${board}" returned 404 at skip=${all.length} after ${all.length} postings`)
    }
    if (!Array.isArray(data)) {
      throw new Error(`Unexpected response for board "${board}": expected an array of postings`)
    }
    // A server that ignores `limit` must not amplify the walk.
    if (data.length > FETCH_PAGE_SIZE) {
      throw new Error(`Board "${board}" returned ${data.length} postings for limit=${FETCH_PAGE_SIZE}`)
    }
    // One terminal probe is allowed at the ceiling, so an exact multiple of the
    // page size can end cleanly; only a non-empty probe means more postings.
    if (all.length + data.length > maxPostings) throw tooMany()
    all.push(...data.map((j) => toCard(j, board, region)))
    if (data.length < FETCH_PAGE_SIZE) return all
  }
}

/** Fetch one posting. Null when the board or posting is unknown (both are 404). */
export function fetchJob(board: string, id: string, region: Region, retry?: RetryPolicy): Promise<ApiJob | null> {
  return jsonFetch<ApiJob>(`${API_HOSTS[region]}/${board}/${id}?mode=json`, retry)
}

// ---------------------------------------------------------------------------
// Client-side filters and formatting
// ---------------------------------------------------------------------------

/** Every whitespace-separated query term must appear in the title (case-insensitive). */
export function matchesQuery(title: string, query: string | undefined): boolean {
  if (!query) return true
  const t = title.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => t.includes(term))
}

/** Case-insensitive substring match on the merged location string. */
export function matchesLocation(location: string | null, wanted: string | undefined): boolean {
  if (!wanted) return true
  return (location ?? "").toLowerCase().includes(wanted.toLowerCase())
}

/** Lever's docs spell on-site as `on-site`; live responses also return `onsite`. */
export function normalizeWorkplace(value: string | null | undefined): Workplace | null {
  const v = (value ?? "").trim().toLowerCase()
  if (v === "remote") return "remote"
  if (v === "hybrid") return "hybrid"
  if (/^on[-_ ]?site$/.test(v)) return "onsite"
  return null
}

/**
 * Match the requested workplace. A posting with no workplace type matches
 * `remote` only when its location says Remote; a known type never falls back,
 * so a hybrid posting that lists a remote location is not treated as remote.
 */
export function matchesWorkplace(card: JobCard, wanted: Workplace | undefined): boolean {
  if (!wanted) return true
  const actual = normalizeWorkplace(card.workplace)
  if (actual) return actual === wanted
  return wanted === "remote" && /\bremote\b/i.test(card.location ?? "")
}

/** Clock-skew allowance for a publish date slightly ahead of this machine's clock. */
const FUTURE_SKEW_MS = 60 * 60 * 1000

/**
 * Posted within N days, judged by createdAt. A date further in the future than
 * the skew allowance fails, rather than passing every cutoff with a negative age.
 */
export function withinDays(date: string | null, days: number | undefined, now = Date.now()): boolean {
  if (!days) return true
  if (!date) return false
  const t = Date.parse(date)
  if (Number.isNaN(t)) return false
  const age = now - t
  return age >= -FUTURE_SKEW_MS && age <= days * 86400000
}

/** Whole amounts print without decimals; fractional ones (hourly pay) keep two. */
export function formatMoney(n: number, currency: string): string {
  const cents = Number.isInteger(n) ? 0 : 2
  const s = n.toLocaleString("en-US", { minimumFractionDigits: cents, maximumFractionDigits: cents })
  if (!currency) return s
  return currency === "USD" ? `$${s}` : `${s} ${currency}`
}

export function formatSalary(salary: SalaryRange): string {
  const amount = `${formatMoney(salary.min, salary.currency)} - ${formatMoney(salary.max, salary.currency)}`
  return salary.interval ? `${amount} (${salary.interval})` : amount
}
