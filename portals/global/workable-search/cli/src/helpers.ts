// Data sources:
//   GET https://www.workable.com/api/accounts/{slug}   documented public board;
//       302s to apply.workable.com/api/v1/widget/accounts/{slug}
//   GET https://apply.workable.com/api/v1/accounts/{slug}/jobs/{shortcode}
//       the board's job endpoint: every location, description, requirements, benefits
// No authentication: Workable documents the list endpoint as a public endpoint, and
// the job endpoint is the one its board pages call. The list returns the account's
// whole posting list in one response, so filtering and paging happen client-side.

export const PUBLIC_API = "https://www.workable.com/api"
export const ACCOUNT_API = "https://apply.workable.com/api/v1"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; workable-cli/1.0)"

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

// ---------------------------------------------------------------------------
// Board slugs and job references
// ---------------------------------------------------------------------------

// Account slugs are subdomains, so they start alphanumeric. Anything else is
// rejected rather than interpolated into the API path.
const BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/

/** A board slug is a URL path segment; anything else is rejected rather than encoded. */
export function isValidBoard(board: string): boolean {
  return BOARD_RE.test(board)
}

const SHORTCODE_RE = /^[A-Za-z0-9]{4,32}$/

export interface JobRef {
  board: string
  id: string
}

function resolveRef(boardFromUrl: string | undefined, id: string, board?: string): JobRef | null {
  if (!SHORTCODE_RE.test(id)) return null
  if (boardFromUrl !== undefined && !isValidBoard(boardFromUrl)) return null
  if (board !== undefined && boardFromUrl !== undefined && board !== boardFromUrl) return null
  const resolved = boardFromUrl ?? board
  if (!resolved) return null
  return { board: resolved, id }
}

/**
 * Resolve a detail argument to { board, id }.
 *
 * Accepts a bare shortcode with --board, or a Workable URL:
 *   apply.workable.com/<slug>/j/<shortcode>[/apply]
 *   apply.workable.com/j/<shortcode>            (shortlink; board needs --board)
 *   apply.workable.com/api/v1|v2/accounts/<slug>/jobs/<shortcode>
 *   <slug>.workable.com/j/<shortcode>           (legacy tenant host)
 *   www.workable.com/j/<shortcode>              (share link, bare domain too;
 *                                                board needs --board)
 * Hosts are compared exactly after real URL parsing, so look-alikes
 * (apply.workable.com.evil.com, evil-workable.com, apply.workable.com@evil.com)
 * are rejected. Query strings and fragments are ignored.
 */
export function parseJobRef(input: string, board?: string): JobRef | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // A bare shortcode carries no slash, colon, query or whitespace.
  if (!/[/:?#\s]/.test(trimmed)) {
    if (!board || !isValidBoard(board)) return null
    return resolveRef(undefined, trimmed, board)
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
  const segments = parsed.pathname.split("/").filter(Boolean)
  // `/apply` is the application form of the same posting.
  if (segments[segments.length - 1]?.toLowerCase() === "apply") segments.pop()

  if (host === "apply.workable.com") {
    if (segments[0] === "api") {
      // /api/v1|v2/accounts/<slug>/jobs/<shortcode>
      if (
        segments.length === 6 &&
        (segments[1] === "v1" || segments[1] === "v2") &&
        segments[2] === "accounts" &&
        segments[4] === "jobs"
      ) {
        return resolveRef(segments[3], segments[5], board)
      }
      return null
    }
    // /j/<shortcode>
    if (segments.length === 2 && segments[0] === "j") {
      return resolveRef(undefined, segments[1], board)
    }
    // /<slug>/j/<shortcode>
    if (segments.length === 3 && segments[1] === "j") {
      return resolveRef(segments[0], segments[2], board)
    }
    return null
  }

  // Share link: www.workable.com/j/<shortcode> (the bare domain too) 301s to the
  // board URL but carries no slug, so the board comes from --board. Parsed only:
  // www.workable.com's robots.txt disallows `/j/`, so it is never fetched.
  if ((host === "www.workable.com" || host === "workable.com") && segments.length === 2 && segments[0] === "j") {
    return resolveRef(undefined, segments[1], board)
  }

  // Legacy tenant host: <slug>.workable.com/j/<shortcode>
  const tenant = host.match(/^([a-z0-9][a-z0-9-]*)\.workable\.com$/)
  if (tenant && tenant[1] !== "www" && tenant[1] !== "apply") {
    if (segments.length === 2 && segments[0] === "j") {
      return resolveRef(tenant[1], segments[1], board)
    }
  }
  return null
}

/** Whether the input is a shortlink (`/j/<shortcode>` on apply, www or the bare domain), which names no board. */
export function isShortlink(input: string): boolean {
  const trimmed = input.trim()
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  const shortlinkHost = host === "apply.workable.com" || host === "www.workable.com" || host === "workable.com"
  return shortlinkHost && /^\/j\/[A-Za-z0-9]{4,32}(?:\/apply)?\/?$/.test(parsed.pathname)
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

/** Convert Workable's posting HTML to readable text, keeping paragraph and list breaks. */
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
}

export interface ApiJobSummary {
  title?: string | null
  shortcode?: string | null
  code?: string | null
  employment_type?: string | null
  department?: string | null
  telecommuting?: boolean | null
  workplace_type?: string | null
  published_on?: string | null
  created_at?: string | null
  country?: string | null
  city?: string | null
  state?: string | null
  locations?: ApiLocation[] | null
}

export interface ApiBoard {
  name?: string | null
  jobs?: ApiJobSummary[] | null
}

export interface ApiJobDetail {
  shortcode?: string | null
  title?: string | null
  remote?: boolean | null
  location?: ApiLocation | null
  locations?: ApiLocation[] | null
  code?: string | null
  published?: string | null
  type?: string | null
  language?: string | null
  department?: string[] | null
  workplace?: string | null
  description?: string | null
  requirements?: string | null
  benefits?: string | null
}

export type Workplace = "remote" | "hybrid" | "onsite"

/**
 * Workable sends `on_site`, `hybrid` or `remote` in `workplace_type`; the CLI
 * uses Ashby's spelling, `onsite`. Anything else, including a non-string from
 * malformed JSON, is unknown.
 */
export function parseWorkplace(value: unknown): Workplace | null {
  if (typeof value !== "string") return null
  const v = value.trim().toLowerCase()
  if (v === "remote") return "remote"
  if (v === "hybrid") return "hybrid"
  if (v === "on_site" || v === "on-site" || v === "onsite") return "onsite"
  return null
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  board: string
  department: string | null
  employmentType: string | null
  requisitionId: string | null
  workplace: Workplace | null
}

export interface JobDetail extends JobCard {
  locations: string[]
  departments: string[]
  remote: boolean
  language: string | null
  description: string | null
  requirements: string | null
  benefits: string | null
}

/** "London, England, United Kingdom"; the region stands in when the city is blank. State is the widget's `state`. */
export function locationLine(loc: ApiLocation | null | undefined): string {
  if (!loc) return ""
  const city = typeof loc.city === "string" ? loc.city.trim() : ""
  const region = typeof loc.region === "string" ? loc.region.trim() : ""
  const country = typeof loc.country === "string" ? loc.country.trim() : ""
  const parts: string[] = []
  if (city) parts.push(city)
  else if (region) parts.push(region)
  // Keep the region when it adds information: `--location` matches this string,
  // and dropping "Ontario" made `-l Ontario` miss a Toronto posting.
  if (city && region && region.toLowerCase() !== city.toLowerCase()) parts.push(region)
  if (country) parts.push(country)
  return parts.join(", ")
}

export function jobUrl(board: string, id: string): string {
  return `https://apply.workable.com/${board}/j/${id}`
}

/**
 * Fold the widget's rows into postings. A multi-location posting arrives once
 * per location with the same shortcode, title and date, so each shortcode is
 * one posting: the first row supplies every field, the rest contribute only
 * their location. `telecommuting` adds "Remote" once.
 */
export function foldPostings(board: ApiBoard, slug: string): JobCard[] {
  const company = typeof board.name === "string" ? board.name.trim() || slug : slug
  const byId = new Map<string, { card: JobCard; locations: Set<string>; tele: boolean; workplace: Workplace | null }>()
  for (const raw of board.jobs ?? []) {
    const id = typeof raw.shortcode === "string" ? raw.shortcode.trim() : ""
    if (!SHORTCODE_RE.test(id)) continue
    const title = typeof raw.title === "string" ? raw.title.trim() : ""
    if (!title) continue
    const location =
      locationLine({ city: raw.city, region: raw.state, country: raw.country }) || locationLine(raw.locations?.[0])
    const tele = Boolean(raw.telecommuting)
    const workplace = parseWorkplace(raw.workplace_type)
    const existing = byId.get(id)
    if (existing) {
      if (location) existing.locations.add(location)
      existing.tele = existing.tele || tele
      existing.workplace = existing.workplace ?? workplace
      continue
    }
    byId.set(id, {
      card: {
        id,
        title,
        company,
        location: null,
        date: raw.published_on ?? raw.created_at ?? null,
        url: jobUrl(slug, id),
        board: slug,
        department: typeof raw.department === "string" ? raw.department.trim() || null : null,
        employmentType: employmentLabel(raw.employment_type),
        requisitionId: typeof raw.code === "string" ? raw.code.trim() || null : null,
        workplace: null,
      },
      locations: new Set(location ? [location] : []),
      tele,
      workplace,
    })
  }
  return [...byId.values()].map(({ card, locations, tele, workplace }) => {
    const list = [...locations]
    if (tele && !list.some((l) => /remote/i.test(l))) list.push("Remote")
    card.location = list.join(" · ") || null
    // A sibling may carry the flag/type the first row lacked; explicit type wins
    // over the telecommuting fallback.
    card.workplace = workplace ?? (tele ? "remote" : null)
    return card
  })
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  full: "Full-time",
  part: "Part-time",
  contract: "Contract",
  temporary: "Temporary",
  internship: "Internship",
  other: "Other",
}

/** Workable sends "full"/"part"/... in `type`; keep an unknown string visible, but a non-string is ignored. */
export function employmentLabel(type: unknown): string | null {
  if (typeof type !== "string") return null
  const value = type.trim()
  if (!value) return null
  return EMPLOYMENT_LABELS[value.toLowerCase()] ?? value
}

/**
 * The detail endpoint carries no account name, so `company` is the board slug
 * (the value every call already names). Search uses the widget's display name.
 */
export function toDetail(job: ApiJobDetail, board: string): JobDetail {
  const id = typeof job.shortcode === "string" ? job.shortcode.trim() : ""
  const remote = Boolean(job.remote)
  const locations = [...new Set((job.locations ?? (job.location ? [job.location] : [])).map(locationLine).filter(Boolean))]
  if (remote && !locations.some((l) => /remote/i.test(l))) locations.push("Remote")
  const departments = (job.department ?? []).map((d) => cleanLine(typeof d === "string" ? d : "")).filter(Boolean)
  const text = (html: string | null | undefined): string | null => (html ? htmlToText(html) || null : null)
  return {
    id,
    title: typeof job.title === "string" && job.title.trim() ? job.title.trim() : "(untitled)",
    company: board,
    location: locations.join(" · ") || null,
    date: job.published ?? null,
    url: jobUrl(board, id),
    board,
    department: departments.join(", ") || null,
    employmentType: employmentLabel(job.type),
    requisitionId: job.code?.trim() || null,
    workplace: parseWorkplace(job.workplace),
    locations,
    departments,
    remote,
    language: job.language?.trim() || null,
    description: text(job.description),
    requirements: text(job.requirements),
    benefits: text(job.benefits),
  }
}

// ---------------------------------------------------------------------------
// Client-side filters
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

/** Case-insensitive substring match on the joined location string. */
export function matchesLocation(location: string | null, wanted: string | undefined): boolean {
  if (!wanted) return true
  return (location ?? "").toLowerCase().includes(wanted.toLowerCase())
}

/** Exact match on the normalized workplace type; unknown postings match nothing. */
export function matchesWorkplace(workplace: Workplace | null, wanted: Workplace | undefined): boolean {
  return !wanted || workplace === wanted
}

/** Clock-skew allowance for a publish date slightly ahead of this machine's clock. */
const FUTURE_SKEW_MS = 60 * 60 * 1000

/**
 * Posted within N days, judged by `published_on` (falling back to `created_at`).
 * A date further in the future than the skew allowance fails, rather than
 * passing every cutoff with a negative age.
 */
export function withinDays(date: string | null, days: number | undefined, now = Date.now()): boolean {
  if (!days) return true
  if (!date) return false
  const t = Date.parse(date)
  if (Number.isNaN(t)) return false
  const age = now - t
  return age >= -FUTURE_SKEW_MS && age <= days * 86400000
}
