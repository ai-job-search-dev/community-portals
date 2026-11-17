// Data source: GameJobs.co public search and posting pages. No authentication.
// Search returns server-rendered HTML: one <div class="job"> card per posting.
// A posting page carries a schema.org JobPosting JSON-LD block plus the
// rendered description in <div class="job-description">.

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

export const BASE_URL = "https://gamejobs.co"
export const SEARCH_URL = `${BASE_URL}/search`

const UA = "Mozilla/5.0 (compatible; gamejobs-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
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

export interface JobCard {
  /** The posting's URL slug, e.g. "Lead-Unity-Developer-at-Aristocrat-4757". Pass it to `detail`. */
  id: string
  /** GameJobs.co's numeric job id (from the card's save form), or null. */
  jobId: string | null
  title: string
  company: string | null
  location: string | null
  /** YYYY-MM-DD, derived from the card's relative age ("3 days ago"); see `dateText`. */
  date: string | null
  /** The age exactly as the board shows it, e.g. "3 days ago", "1 month ago". */
  dateText: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  /** schema.org validThrough, YYYY-MM-DD, or null. */
  deadline: string | null
  /** The external apply link the posting page points to, or null. */
  applyUrl: string | null
  /** False when the posting's validThrough has passed; a removed posting returns 404 and never reaches here. */
  isActive: boolean
}

export interface SearchPage {
  total: number | null
  hasNext: boolean
  results: JobCard[]
}

/**
 * Map --jobage (days) to the board's posted-within filter. The board only knows
 * 1d, 7d and 31d (any other value is silently ignored and returns every date),
 * so pick the smallest window that covers the request; the CLI then filters to
 * the exact age client-side. Returns null for "no filter".
 */
export function ageParam(days: number | undefined): string | null {
  if (!days || days >= 9999) return null
  if (days <= 1) return "1d"
  if (days <= 7) return "7d"
  if (days <= 31) return "31d"
  return null
}

/**
 * Turn the board's relative age into a date. "today"/"just now"/hours and
 * minutes map to today. Months and years are approximated (30 and 365 days),
 * which is why the raw text is kept alongside in `dateText`.
 */
export function relativeToDate(text: string | null, now: Date = new Date()): string | null {
  if (!text) return null
  const t = text.trim().toLowerCase()
  const day = 86400000
  let ms: number | null = null
  if (/^(today|just now)$/.test(t) || /\b(second|minute|hour)s?\s+ago$/.test(t)) ms = 0
  else if (t === "yesterday") ms = day
  else {
    const m = t.match(/^(\d+|a|an)\s+(day|week|month|year)s?\s+ago$/)
    if (m) {
      const n = m[1] === "a" || m[1] === "an" ? 1 : parseInt(m[1], 10)
      const unit = { day: 1, week: 7, month: 30, year: 365 }[m[2] as "day" | "week" | "month" | "year"]
      ms = n * unit * day
    }
  }
  if (ms === null) return null
  return new Date(now.getTime() - ms).toISOString().slice(0, 10)
}

/** Age in whole days of a YYYY-MM-DD date relative to now (null when unknown). */
export function ageInDays(date: string | null, now: Date = new Date()): number | null {
  if (!date) return null
  const then = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(then)) return null
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((today - then) / 86400000)
}

/** Slug from a path like "/Lead-Unity-Developer-at-Aristocrat-4757", decoded. */
function slugFromHref(href: string): string {
  const path = decodeHtmlEntities(href).split(/[?#]/)[0].replace(/^\/+/, "")
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export function postingUrl(slug: string): string {
  return `${BASE_URL}/${encodeURIComponent(slug).replace(/%2F/gi, "/")}`
}

/**
 * Parse a search results page. Split on the card opener so one malformed card
 * cannot break the rest; the dismissible banner uses a different class and is
 * never a card.
 */
export function parseSearch(html: string, now: Date = new Date()): SearchPage {
  const totalMatch = html.match(/<div class="summary">\s*([\d,]+)\s+results?\s*<\/div>/i)
  const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : null
  const hasNext = /<a[^>]+href="\/search\?[^"]*\bp=\d+[^"]*"[^>]*>\s*Next\s*<\/a>/i.test(html)

  const results: JobCard[] = []
  const chunks = html.split(/<div class="job">/).slice(1)
  for (const raw of chunks) {
    // A chunk runs to the next card; cut the trailing pager off the last one.
    const chunk = raw.split(/<div class="flexc tc paging">/)[0]
    const titleMatch = chunk.match(/<a class="title" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue
    const id = slugFromHref(titleMatch[1])
    const title = clean(titleMatch[2])
    if (!id || !title) continue

    const companyMatch = chunk.match(/<a [^>]*class="c"[^>]*>([\s\S]*?)<\/a>/i)
    const company = companyMatch ? clean(companyMatch[1]) || null : null

    const locations = [...chunk.matchAll(/<a [^>]*class="w"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => clean(m[1]))
      .filter(Boolean)
    const location = locations.length ? locations.join(" · ") : null

    // The age is the bare text segment before the save form: "... · 7 days ago · <form".
    const ageMatch = chunk.match(/·\s*([^·<>]*?\bago|today|yesterday|just now)\s*·\s*<form/i)
    const dateText = ageMatch ? clean(ageMatch[1]) : null

    const jobIdMatch = chunk.match(/data-job-id="(\d+)"/)
    results.push({
      id,
      jobId: jobIdMatch ? jobIdMatch[1] : null,
      title,
      company,
      location,
      date: relativeToDate(dateText, now),
      dateText,
      url: postingUrl(id),
    })
  }
  return { total, hasNext, results }
}

/** "search" is the board's search page, not a posting; any other slug (even "search-engineer-...") is fine. */
function isReserved(slug: string): boolean {
  return slug.toLowerCase() === "search"
}

/** Resolve an href against the posting URL and keep it only when it is http(s). */
export function safeLink(href: string | null | undefined, base: string): string | null {
  if (!href) return null
  try {
    const u = new URL(decodeHtmlEntities(href).trim(), base)
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null
  } catch {
    return null
  }
}

/**
 * Accept a slug, a "/slug" path, or a gamejobs.co URL (with or without scheme).
 * A URL on any other host is rejected, so an apply link from another site never
 * gets fetched as if it were a GameJobs.co posting.
 */
export function normalizeSlug(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^(www\.)?gamejobs\.co(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!/^(www\.)?gamejobs\.co$/i.test(parsed.hostname)) return null
    const slug = slugFromHref(parsed.pathname)
    return slug && !slug.includes("/") && !isReserved(slug) ? slug : null
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
  const slug = slugFromHref(trimmed)
  if (!slug || slug.includes("/") || isReserved(slug)) return null
  return slug
}

interface LdJobPosting {
  "@type"?: string
  title?: string
  datePosted?: string
  validThrough?: string
  employmentType?: string | string[]
  hiringOrganization?: { name?: string }
  identifier?: { value?: string | number }
  jobLocation?: unknown
}

function ldLocation(loc: unknown): string | null {
  const places = Array.isArray(loc) ? loc : loc ? [loc] : []
  const names = places
    .map((p) => {
      const a = (p as { address?: Record<string, unknown> })?.address ?? {}
      return [a.addressLocality, a.addressRegion, a.addressCountry]
        .map((v) => (typeof v === "string" ? v : (v as { name?: string } | undefined)?.name))
        .filter((v): v is string => !!v)
        .join(", ")
    })
    .filter(Boolean)
  return names.length ? names.join(" · ") : null
}

/** Parse a posting page. Card fields fall back to the rendered header when the JSON-LD is missing. */
export function parseDetail(html: string, slug: string, now: Date = new Date()): JobDetail {
  let ld: LdJobPosting | null = null
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1])
      if (data && data["@type"] === "JobPosting") {
        ld = data as LdJobPosting
        break
      }
    } catch {
      // A malformed block is skipped; the rendered page still gives the fields.
    }
  }

  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html
  const h1 = article.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const company = article.match(/<a [^>]*class="c"[^>]*>([\s\S]*?)<\/a>/i)?.[1]
  const locations = [...article.matchAll(/<a [^>]*class="w"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => clean(m[1])).filter(Boolean)
  const ageText = article.match(/<div>\s*([^<]*?\bago|today|yesterday|just now)\s*<\/div>/i)?.[1] ?? null
  const apply = article.match(/<a class="btn[^"]*" href="([^"]+)"[^>]*>\s*Apply\s*<\/a>/i)?.[1]

  let description: string | null = null
  const descHtml = extractDivContent(html, "job-description")
  if (descHtml) {
    const withBreaks = visibleHtml(descHtml)
      .replace(/\s+/g, " ")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    description = withBreaks.split("\n").map(clean).join("\n").replace(/\n{3,}/g, "\n\n").trim() || null
  }

  const posted = ld?.datePosted?.slice(0, 10) ?? null
  const deadline = ld?.validThrough && /^\d{4}-\d\d-\d\d/.test(ld.validThrough) ? ld.validThrough.slice(0, 10) : null
  const employment = Array.isArray(ld?.employmentType) ? ld?.employmentType.join(", ") : ld?.employmentType
  return {
    id: slug,
    jobId: ld?.identifier?.value != null ? String(ld.identifier.value) : null,
    title: (h1 ? clean(h1) : "") || (ld?.title ? clean(ld.title) : "(untitled)"),
    company: (company ? clean(company) : "") || (ld?.hiringOrganization?.name ? clean(ld.hiringOrganization.name) : null),
    location: locations.length ? locations.join(" · ") : ldLocation(ld?.jobLocation),
    date: posted && /^\d{4}-\d\d-\d\d$/.test(posted) ? posted : relativeToDate(ageText ? clean(ageText) : null, now),
    dateText: ageText ? clean(ageText) : null,
    url: postingUrl(slug),
    description,
    employmentType: employment ? clean(employment) : null,
    deadline,
    applyUrl: safeLink(apply, postingUrl(slug)),
    // A page that rendered is listed; a validThrough in the past means it has closed.
    isActive: (ageInDays(deadline, now) ?? 0) <= 0,
  }
}
