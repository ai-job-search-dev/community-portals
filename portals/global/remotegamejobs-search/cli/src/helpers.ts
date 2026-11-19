// Data source: Remote Game Jobs (remotegamejobs.com) public pages. No authentication.
// - /search?query=<text>: server-side full-text search, every match on one page.
// - /remote-game-<category>-jobs: every open posting in one category.
// - /feed.rss: the newest postings with exact dates (cards carry no date).
// - /jobs/<slug>: one posting, with JSON-LD JobPosting and a "Remote scope" fact.
// /goto/<slug> (the apply redirect) is disallowed by robots.txt and never fetched.

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

export const BASE_URL = "https://remotegamejobs.com"
export const SEARCH_URL = `${BASE_URL}/search`
export const FEED_URL = `${BASE_URL}/feed.rss`

/** Category slugs (the CLI's --category values) mapped to the board's category page paths. */
export const CATEGORIES: Record<string, string> = {
  "art-and-animation": "remote-game-art-and-animation-jobs",
  "business-analysis": "remote-game-business-analysis-jobs",
  "community-management": "remote-game-community-management-jobs",
  design: "remote-game-design-jobs",
  "music-sound-design": "remote-game-music-sound-design-jobs",
  production: "remote-game-production-jobs",
  programming: "remote-game-programming-jobs",
  "quality-assurance": "remote-game-quality-assurance-jobs",
  "sales-marketing": "remote-game-sales-marketing-jobs",
  "voice-acting": "remote-game-voice-acting-jobs",
  writing: "remote-game-writing-jobs",
}

export const categoryUrl = (slug: string) => `${BASE_URL}/${CATEGORIES[slug]}`
export const postingUrl = (slug: string) => `${BASE_URL}/jobs/${slug}`

const UA = "Mozilla/5.0 (compatible; remotegamejobs-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Fetch text with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function textFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
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
  /** The posting slug, e.g. "skymap-games-multiplayer-engineer-unity-remote-job". Pass it to `detail`. */
  id: string
  title: string
  company: string | null
  /** The posting's remote scope, as the studio wrote it ("Worldwide", "Remote Europe", "Must be based in Quebec"). */
  location: string | null
  /** YYYY-MM-DD from the RSS feed, or null when the posting is older than the feed. */
  date: string | null
  url: string
  category: string | null
  /** Engagement and level chips, e.g. ["Contract", "Senior"]. */
  tags: string[]
  /** The card's salary text, or null when the card says "Salary not listed". */
  salary: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  /** JSON-LD applicantLocationRequirements, e.g. "Canada", or null. */
  applicantLocation: string | null
  /** JSON-LD validThrough, YYYY-MM-DD, or null. */
  deadline: string | null
  /** The board's apply redirect. Printed for the reader, never fetched (robots.txt disallows /goto/). */
  applyUrl: string | null
}

function slugFromUrl(href: string): string | null {
  const m = decodeHtmlEntities(href).match(/^(?:https?:\/\/(?:www\.)?remotegamejobs\.com)?\/jobs\/([a-z0-9-]+)\/?(?:[?#].*)?$/i)
  return m ? m[1].toLowerCase() : null
}

/** Parse a search or category page: one `<a class="card">` per posting, parsed independently. */
export function parseCards(html: string): JobCard[] {
  const results: JobCard[] = []
  // Keep chunks that start with a card. (A lookahead split yields no empty
  // leading chunk when the HTML starts with a card, so slice(1) would drop it.)
  const chunks = html.split(/(?=<a title="[^"]*" class="card")/).filter((c) => /^<a title="[^"]*" class="card"/.test(c))
  for (const raw of chunks) {
    const chunk = raw.split(/<\/a>/)[0]
    const href = chunk.match(/class="card"[^>]*href="([^"]+)"/)?.[1]
    const id = href ? slugFromUrl(href) : null
    const h3 = chunk.match(/<h3>([\s\S]*?)<\/h3>/i)?.[1]
    if (!id || !h3) continue
    const company = chunk.match(/<div class="sub"><b>([\s\S]*?)<\/b>/i)?.[1]
    const scope = chunk.match(/<span class="scope"><span>([\s\S]*?)<\/span>/i)?.[1]
    const category = chunk.match(/<span class="chip chip-o">([\s\S]*?)<\/span>/i)?.[1]
    const chips = [...chunk.matchAll(/<span class="chip">([\s\S]*?)<\/span>/gi)].map((m) => clean(m[1])).filter(Boolean)
    const side = chunk.match(/<div class="side">([\s\S]*?)<\/div>/i)?.[1]
    const salaryText = side ? clean(side) : ""
    results.push({
      id,
      title: clean(h3),
      company: company ? clean(company) || null : null,
      location: scope ? clean(scope) || null : null,
      date: null,
      url: postingUrl(id),
      category: category ? clean(category) || null : null,
      tags: chips,
      salary: salaryText && !/not listed/i.test(salaryText) ? salaryText : null,
    })
  }
  return results
}

/** Map posting slug -> YYYY-MM-DD from the RSS feed. */
export function parseFeedDates(xml: string): Map<string, string> {
  const dates = new Map<string, string>()
  for (const item of xml.split(/<item>/i).slice(1)) {
    const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1]
    const pub = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]
    const id = link ? slugFromUrl(link.trim()) : null
    const t = pub ? Date.parse(pub.trim()) : NaN
    if (id && !Number.isNaN(t)) dates.set(id, new Date(t).toISOString().slice(0, 10))
  }
  return dates
}

/** Age in whole days of a YYYY-MM-DD date relative to now (null when unknown). */
export function ageInDays(date: string | null, now: Date = new Date()): number | null {
  if (!date) return null
  const then = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(then)) return null
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((today - then) / 86400000)
}

/**
 * Accept a slug or a remotegamejobs.com /jobs/<slug> URL. Any other host, and
 * the /goto/ apply redirect, are rejected.
 */
export function normalizeSlug(input: string): string | null {
  const trimmed = input.trim()
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(trimmed)) return trimmed.toLowerCase()
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (!hasScheme && !/^(www\.)?remotegamejobs\.com\//i.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (!/^(www\.)?remotegamejobs\.com$/i.test(parsed.hostname)) return null
  const m = parsed.pathname.match(/^\/jobs\/([a-z0-9-]+)\/?$/i)
  return m ? m[1].toLowerCase() : null
}

interface LdJobPosting {
  "@type"?: string
  title?: string
  datePosted?: string
  validThrough?: string
  employmentType?: string | string[]
  hiringOrganization?: { name?: string }
  applicantLocationRequirements?: unknown
}

function ldNames(value: unknown): string | null {
  const list = Array.isArray(value) ? value : value ? [value] : []
  const names = list.map((v) => (v as { name?: string })?.name).filter((n): n is string => !!n)
  return names.length ? names.map((n) => clean(n)).join(", ") : null
}

/** The value next to a "facts" label, e.g. fact(html, "Remote scope"). */
function fact(html: string, label: string): string | null {
  const re = new RegExp(`<span class="px">${label}</span>([\\s\\S]*?)</div>`, "i")
  const v = html.match(re)?.[1]
  const text = v ? clean(v) : ""
  return text && !/^not listed$/i.test(text) ? text : null
}

/** Parse a posting page. */
export function parseDetail(html: string, slug: string): JobDetail {
  let ld: LdJobPosting | null = null
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1])
      if (data && data["@type"] === "JobPosting") {
        ld = data as LdJobPosting
        break
      }
    } catch {
      // Skip a malformed block; the rendered page still has the fields.
    }
  }

  const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/i)?.[1]
  const byline = html.match(/<div class="byline">([\s\S]*?)<\/div>/i)?.[1] ?? ""
  const bylineLinks = [...byline.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/gi)].map((m) => clean(m[1]))
  const typeLevel = fact(html, "Type · level")
  const apply = html.match(/href="((?:https:\/\/remotegamejobs\.com)?\/goto\/[a-z0-9-]+)"/i)?.[1]

  let description: string | null = null
  const body = extractDivContent(html, "trix-content")
  if (body) {
    const withBreaks = visibleHtml(body)
      .replace(/\s+/g, " ")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    description = withBreaks.split("\n").map((l) => clean(l).trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim() || null
  }

  const employment = Array.isArray(ld?.employmentType) ? ld?.employmentType.join(", ") : ld?.employmentType
  const posted = ld?.datePosted?.slice(0, 10)
  return {
    id: slug,
    title: (h1 ? clean(h1) : "") || (ld?.title ? clean(ld.title) : "(untitled)"),
    company: bylineLinks[0] || (ld?.hiringOrganization?.name ? clean(ld.hiringOrganization.name) : null),
    location: fact(html, "Remote scope"),
    date: posted && /^\d{4}-\d\d-\d\d$/.test(posted) ? posted : null,
    url: postingUrl(slug),
    category: bylineLinks[1] || null,
    tags: typeLevel ? typeLevel.split(/\s*·\s*/).filter(Boolean) : [],
    salary: fact(html, "Salary"),
    description,
    employmentType: employment ? clean(employment) : null,
    applicantLocation: ldNames(ld?.applicantLocationRequirements),
    deadline: ld?.validThrough && /^\d{4}-\d\d-\d\d/.test(ld.validThrough) ? ld.validThrough.slice(0, 10) : null,
    applyUrl: apply ? (apply.startsWith("/") ? BASE_URL + apply : apply) : null,
  }
}
