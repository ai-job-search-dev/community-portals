// Data source: Greenhouse's public Job Board API (boards-api.greenhouse.io).
// No authentication required for GET requests; it is the API Greenhouse
// publishes for career sites to read their own job boards. Boards are per
// company ("board token", e.g. "gitlab"), so every call names a board.
// The list endpoint returns the whole board in one response with no server-side
// keyword filter or pagination; this CLI filters and pages client-side.

export const API_HOSTS = {
  us: "https://boards-api.greenhouse.io/v1/boards",
  eu: "https://boards-api.eu.greenhouse.io/v1/boards",
} as const
export type Region = keyof typeof API_HOSTS

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; greenhouse-cli/1.0)"

/** Retry policy for jsonFetch; tests pass a fast one. */
export interface RetryPolicy {
  maxRetries: number
  baseDelayMs: number
}
const DEFAULT_RETRY: RetryPolicy = { maxRetries: 6, baseDelayMs: 500 }

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
      // Honor a numeric Retry-After (seconds, capped at 30); otherwise back off exponentially.
      const retryAfter = Number(response.headers.get("retry-after"))
      const wait = retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : delay + Math.floor(Math.random() * delay)
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
// Board tokens and job references
// ---------------------------------------------------------------------------

const BOARD_RE = /^[A-Za-z0-9_-]{1,100}$/

/** A board token is a URL path segment; anything else is rejected rather than encoded. */
export function isValidBoard(board: string): boolean {
  return BOARD_RE.test(board)
}

const HOST_REGION: Record<string, Region> = {
  "job-boards.greenhouse.io": "us",
  "boards.greenhouse.io": "us",
  "boards-api.greenhouse.io": "us",
  "job-boards.eu.greenhouse.io": "eu",
  "boards.eu.greenhouse.io": "eu",
  "boards-api.eu.greenhouse.io": "eu",
}

export interface JobRef {
  board: string
  id: string
  region: Region
}

/**
 * Resolve a detail argument to { board, id, region }.
 *
 * Accepts a numeric job ID (board then comes from --board), or a Greenhouse
 * URL: job-boards/boards[.eu].greenhouse.io/<board>/jobs/<id>, the API URL
 * form, or the embed form (?for=<board>&token=<id>). Hosts are compared
 * exactly after real URL parsing, so look-alikes (greenhouse.io.evil.com,
 * evil-greenhouse.io, greenhouse.io@evil.com) are rejected. A company careers
 * page carrying ?gh_jid= is rejected too: its board token cannot be known
 * from the URL, so pass the ID with --board instead.
 */
export function parseJobRef(input: string, board?: string, region: Region = "us"): JobRef | null {
  const trimmed = input.trim()
  if (/^\d{4,}$/.test(trimmed)) {
    if (!board || !isValidBoard(board)) return null
    return { board, id: trimmed, region }
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

  const path = parsed.pathname.match(/^\/(?:v1\/boards\/)?([A-Za-z0-9_-]+)\/jobs\/(\d{4,})\/?$/)
  if (path) {
    if (board && board !== path[1]) return null
    return { board: path[1], id: path[2], region: urlRegion }
  }

  const embedBoard = parsed.searchParams.get("for")
  const embedId = parsed.searchParams.get("token")
  if (embedBoard && embedId && isValidBoard(embedBoard) && /^\d{4,}$/.test(embedId)) {
    if (board && board !== embedBoard) return null
    return { board: embedBoard, id: embedId, region: urlRegion }
  }
  return null
}

// ---------------------------------------------------------------------------
// Text hygiene (kept in step with community-portals linkedin-search helpers.ts)
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
 * "&amp;lt;" must become the literal text "&lt;", never "<", and Greenhouse's
 * double-escaped content ("&amp;mdash;") must come out of the first layer as
 * "&mdash;" so the second layer can decode it.
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
  return decodeHtmlEntities(html.replace(new RegExp(`<${ATTRS}>`, "g"), " ")).replace(/[ \t ]+/g, " ").trim()
}

/**
 * Convert posting HTML to readable text, keeping paragraph and list breaks.
 * Greenhouse's `content` field is HTML that has itself been entity-escaped
 * ("&lt;p&gt;..."), so pass `escaped: true` to decode that outer layer first.
 */
export function htmlToText(html: string, escaped = false): string {
  const markup = escaped ? decodeHtmlEntities(html) : html
  const withBreaks = visibleHtml(markup)
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

export interface ApiJob {
  id: number
  title: string
  absolute_url: string
  company_name?: string | null
  location?: { name?: string | null } | null
  first_published?: string | null
  updated_at?: string | null
  requisition_id?: string | null
  language?: string | null
  application_deadline?: string | null
  content?: string | null
  departments?: { name: string }[] | null
  offices?: { name: string; location?: string | null }[] | null
  pay_input_ranges?: {
    min_cents: number
    max_cents: number
    currency_type: string
    title?: string | null
    blurb?: string | null
  }[] | null
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  board: string
  requisitionId: string | null
  updated: string | null
}

export interface PayRange {
  min: number
  max: number
  currency: string
  label: string | null
  note: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  departments: string[]
  offices: string[]
  payRanges: PayRange[]
  deadline: string | null
  language: string | null
}

export function toCard(job: ApiJob, board: string): JobCard {
  return {
    id: String(job.id),
    title: (job.title ?? "").trim() || "(untitled)",
    company: job.company_name?.trim() || null,
    location: job.location?.name?.trim() || null,
    date: job.first_published ?? job.updated_at ?? null,
    url: job.absolute_url || `https://job-boards.greenhouse.io/${board}/jobs/${job.id}`,
    board,
    requisitionId: job.requisition_id ?? null,
    updated: job.updated_at ?? null,
  }
}

export function toDetail(job: ApiJob, board: string): JobDetail {
  return {
    ...toCard(job, board),
    description: job.content ? htmlToText(job.content, true) || null : null,
    departments: (job.departments ?? []).map((d) => d.name).filter(Boolean),
    offices: (job.offices ?? []).map((o) => (o.location ? `${o.name} (${o.location})` : o.name)).filter(Boolean),
    payRanges: (job.pay_input_ranges ?? []).map((p) => ({
      min: p.min_cents / 100,
      max: p.max_cents / 100,
      currency: p.currency_type,
      label: p.title ? cleanLine(p.title).replace(/:\s*$/, "") || null : null,
      note: p.blurb ? htmlToText(p.blurb) || null : null,
    })),
    deadline: job.application_deadline ?? null,
    language: job.language ?? null,
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

/** Case-insensitive substring match on the location name. */
export function matchesLocation(location: string | null, wanted: string | undefined): boolean {
  if (!wanted) return true
  return (location ?? "").toLowerCase().includes(wanted.toLowerCase())
}

/** Clock-skew allowance for a publish date slightly ahead of this machine's clock. */
const FUTURE_SKEW_MS = 60 * 60 * 1000

/**
 * Posted within N days, judged by first_published (falling back to updated_at).
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

/** Whole amounts print without decimals; fractional ones (hourly pay) keep two. */
export function formatMoney(n: number, currency: string): string {
  const cents = Number.isInteger(n) ? 0 : 2
  const s = n.toLocaleString("en-US", { minimumFractionDigits: cents, maximumFractionDigits: cents })
  return currency === "USD" ? `$${s}` : `${s} ${currency}`
}
