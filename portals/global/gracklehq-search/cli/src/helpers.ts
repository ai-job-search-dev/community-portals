// Data source: Grackle HQ's public, server-rendered job list (gracklehq.com/jobs).
// Grackle gathers postings from studios' own careers pages daily and links each
// one through /rd/<id>, a 302 redirect to the employer's posting. It hosts no
// description of its own, so `detail` resolves that redirect.

// ---------- HTML hygiene ----------
// Copied verbatim from community-portals'
// portals/global/linkedin-search/cli/src/helpers.ts (MIT) so this portal stays
// self-contained. Only `export` keywords were added. Listing text is third-party
// data: visibleHtml drops markup a reader never sees, stripInvisible removes
// characters a reader never sees, before any output format is produced.

/**
 * Extract the inner HTML of a <div> identified by a CSS class name, correctly
 * handling nested <div> elements by tracking tag depth.
 */
export function extractDivContent(html: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const openRe = new RegExp(`<div[^>]*class="[^"]*${escaped}[^"]*"[^>]*>`, 'i')
  const open = openRe.exec(html)
  if (!open) return null

  let i = open.index + open[0].length
  let depth = 1

  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf('<div', i)
    const nextClose = html.indexOf('</div>', i)

    if (nextClose === -1) return null

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }

  return html.slice(open.index + open[0].length, i - 6)
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
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

export function stripTags(html: string): string {
  return visibleHtml(html).replace(new RegExp(`<${ATTRS}>`, "g"), " ").replace(/\s+/g, " ").trim()
}

export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

// ---------- portal ----------

export const BASE_URL = "https://gracklehq.com"
export const JOBS_URL = `${BASE_URL}/jobs`
export const PAGE_SIZE = 30

const UA = "Mozilla/5.0 (compatible; gracklehq-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

async function withBackoff(url: string, redirect: RequestRedirect): Promise<Response | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
      redirect,
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 500)))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    return response
  }
  throw new Error("Request failed after max retries")
}

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const response = await withBackoff(url, "follow")
  if (!response) return ""
  if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
  return response.text()
}

export type Resolved = { target: string } | { missing: true } | { error: string }

/**
 * Resolve /rd/<id> without following it. A 404 means Grackle removed the job;
 * any other non-redirect answer (a 403 block, a 200 page) is reported as an
 * error, not as a removed job. Only http(s) targets are returned.
 */
export async function resolveRedirect(url: string): Promise<Resolved> {
  const response = await withBackoff(url, "manual")
  if (!response) return { missing: true }
  if (response.status >= 300 && response.status < 400) {
    const loc = response.headers.get("location")
    if (!loc) return { error: `redirect without a Location header (${response.status})` }
    let target: URL
    try {
      target = new URL(loc, url)
    } catch {
      return { error: "redirect to an unparsable URL" }
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return { error: `redirect to a non-http(s) URL (${target.protocol})` }
    }
    return { target: target.href }
  }
  return { error: `expected a redirect, got ${response.status} ${response.statusText}`.trim() }
}

export interface JobCard {
  /** Grackle's numeric id from /rd/<id>. Pass it to `detail`. */
  id: string
  title: string
  company: string | null
  location: string | null
  /** YYYY-MM-DD derived from the card's age ("<1d", "7d"); see `dateText`. */
  date: string | null
  /** The age exactly as the board shows it. */
  dateText: string | null
  /** Grackle's redirect link; `detail` resolves it to the employer's posting. */
  url: string
}

export interface SearchPage {
  total: number | null
  hasNext: boolean
  results: JobCard[]
}

export interface SearchParams {
  query?: string
  location?: string
  department?: string
  page: number
}

/** The board only knows one text box: a case-insensitive substring of the title. Quotes are literal there, so drop them. */
export function boardQuery(query: string | undefined): string | undefined {
  if (!query) return undefined
  const q = query.replace(/["']/g, " ").replace(/\s+/g, " ").trim()
  return q || undefined
}

export function buildUrl(p: SearchParams): string {
  const params = new URLSearchParams()
  const q = boardQuery(p.query)
  if (q) params.set("searchstring", q)
  if (p.location) {
    // "Remote" is a metro area on Grackle; anything else is tried as a country.
    if (/^remote$/i.test(p.location)) params.set("metro", "Remote")
    else params.set("country", p.location)
  }
  if (p.department) params.set("department", p.department)
  if (p.page > 1) params.set("pageidx", String(p.page))
  const qs = params.toString()
  return qs ? `${JOBS_URL}?${qs}` : JOBS_URL
}

/** "<1d" and "Nd" are days since Grackle first saw the posting. */
export function ageToDate(text: string | null, now: Date = new Date()): string | null {
  if (!text) return null
  const t = text.trim()
  let days: number | null = null
  if (/^<\s*1d$/i.test(t)) days = 0
  else {
    const m = t.match(/^(\d+)\s*d$/i)
    if (m) days = parseInt(m[1], 10)
  }
  if (days === null) return null
  return new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10)
}

export function ageInDays(date: string | null, now: Date = new Date()): number | null {
  if (!date) return null
  const then = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(then)) return null
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((today - then) / 86400000)
}

/** The board double-escapes some titles ("&amp;amp;"); decode until stable. */
function text(raw: string): string {
  let s = clean(raw)
  for (let i = 0; i < 2 && /&(amp|#x?[0-9a-f]+|lt|gt|quot|#39);/i.test(s); i++) s = decodeHtmlEntities(s)
  return s
}

/**
 * Parse a results page. Split on the card opener so one malformed card cannot
 * break the rest. The line under the title is "<Company> - <Location>"; the
 * split is on the last " - ", because places never contain one.
 */
export function parseJobs(html: string, now: Date = new Date()): SearchPage {
  const totalMatch = html.match(/class="jobsresultscountrow">\s*([\d,]+)\s+results?/i)
  const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : null
  const hasNext = /<a href="\.\/jobs\?[^"]*pageidx=\d+"\s+class="btn btn-default\s*">\s*Next\s*<\/a>/i.test(html)

  const results: JobCard[] = []
  for (const chunk of html.split(/<div class="joblisting">/).slice(1)) {
    const link = chunk.match(/<a href="\/rd\/(\d+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!link) continue
    const title = text(link[2])
    if (!title) continue
    const line = chunk.slice(chunk.indexOf(link[0]) + link[0].length).match(/<div>([\s\S]*?)<\/div>/i)
    let company: string | null = null
    let location: string | null = null
    if (line) {
      const both = text(line[1])
      const cut = both.lastIndexOf(" - ")
      if (cut > 0) {
        company = both.slice(0, cut).trim() || null
        location = both.slice(cut + 3).trim() || null
      } else company = both || null
    }
    const age = chunk.match(/<div class="bottomright">([\s\S]*?)<\/div>/i)
    const dateText = age ? text(age[1]) || null : null
    results.push({
      id: link[1],
      title,
      company,
      location,
      date: ageToDate(dateText, now),
      dateText,
      url: `${BASE_URL}/rd/${link[1]}`,
    })
  }
  return { total, hasNext, results }
}

/** Accept a numeric id or a gracklehq.com/rd/<id> URL; anything else is rejected. */
export function normalizeId(input: string): string | null {
  const t = input.trim()
  if (/^\d+$/.test(t)) return t
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
  } catch {
    return null
  }
  if (!/^(www\.)?gracklehq\.com$/i.test(u.hostname)) return null
  const m = u.pathname.match(/^\/rd\/(\d+)\/?$/)
  return m ? m[1] : null
}

function hasTerm(hay: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}`, "iu").test(hay)
}

/**
 * The board's substring match also returns "Community" for "unity". Keep a card
 * only when the query, as the board matched it, starts at a word boundary in
 * the title.
 */
export function startsAtWord(title: string, query: string | undefined): boolean {
  const q = boardQuery(query)
  return !q || hasTerm(title, q)
}
