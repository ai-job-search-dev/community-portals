// Data source: Work With Indies' public RSS feed, /careers/rss.xml, which the
// site links in its own footer. It carries the 100 newest postings, dated, each
// with a headline, a one-paragraph summary and tags.
//
// Feed only, on purpose: the board's terms (https://www.workwithindies.com/terms)
// forbid using the service "to spider, crawl, or scrape", so this CLI never
// fetches or parses the site's HTML pages (category lists or postings). All
// filtering happens client-side over the feed.

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

export const BASE_URL = "https://www.workwithindies.com"
export const FEED_URL = `${BASE_URL}/careers/rss.xml`

/** Category slugs as the board's navigation names them, mapped to the feed's tag text. */
export const CATEGORIES: Record<string, string> = {
  "art-animation": "Art & Animation",
  audio: "Audio",
  business: "Business & Operations",
  design: "Design",
  marketing: "Marketing & Community",
  production: "Production",
  programming: "Programming",
  "qa-cs": "QA & CS",
  writing: "Writing",
}

export const postingUrl = (slug: string) => `${BASE_URL}/careers/${slug}`

const UA = "Mozilla/5.0 (compatible; workwithindies-cli/1.0)"

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
        Accept: "application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
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
  /** The posting slug, e.g. "creature-unity-gameplay-tools-programmer". Pass it to `detail`. */
  id: string
  title: string
  company: string | null
  /** Where the job can be done from, as the studio wrote it ("Anywhere", "PT ± 3 hours", "Copenhagen, DK"). */
  location: string | null
  /** YYYY-MM-DD from the feed's pubDate. */
  date: string | null
  url: string
  /** The feed's one-paragraph summary (the feed carries no full description). */
  summary: string | null
  /** Board tags: category and engagement, e.g. ["Programming", "Contract"]. */
  tags: string[]
}

export interface JobDetail extends JobCard {
  /** The feed summary. The full description is only on the posting page, which this CLI does not fetch. */
  description: string | null
  /** The engagement tag (Full Time, Part Time, Contract, Freelance), or null. */
  employmentType: string | null
}

const ENGAGEMENTS = new Set(["full time", "part time", "contract", "freelance", "internship"])

/**
 * Split a headline "<Company> is hiring a <Role> to work from <Place>" (or
 * "... to join their team in [the] <Place>") into its parts. A headline that
 * does not follow the pattern keeps its full text as the title.
 */
export function splitHeadline(text: string): { company: string | null; title: string; location: string | null } {
  const m = text.match(/^(.*?)\s+is hiring an?\s+(.*?)\s+(?:to work from|to join their team in(?: the)?)\s+(.*)$/i)
  if (!m) return { company: null, title: text.trim(), location: null }
  return { company: m[1].trim() || null, title: m[2].trim(), location: m[3].trim() || null }
}

function slugFromUrl(href: string): string | null {
  const m = decodeHtmlEntities(href).match(/\/careers\/([a-z0-9-]+)\/?(?:[?#].*)?$/i)
  return m ? m[1].toLowerCase() : null
}

function rssDate(text: string | undefined): string | null {
  if (!text) return null
  const t = Date.parse(text.trim())
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

const tagValue = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"))?.[1]

/** Strip a CDATA wrapper, if any. */
const unCdata = (s: string) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")

/**
 * Text of an RSS element. RSS escapes any HTML it carries (`&lt;p&gt;`), so
 * undo that layer first: then visibleHtml (inside clean) sees real tags and can
 * drop hidden ones, instead of their text surviving as literal markup.
 */
const feedText = (raw: string) => clean(decodeHtmlEntities(unCdata(raw)))

/** Parse the RSS feed: one item per posting, each parsed on its own so a bad item cannot break the rest. */
export function parseFeed(xml: string): JobCard[] {
  const results: JobCard[] = []
  for (const item of xml.split(/<item>/i).slice(1)) {
    const body = item.split(/<\/item>/i)[0]
    const link = tagValue(body, "link")
    const id = link ? slugFromUrl(unCdata(link)) : null
    const headline = tagValue(body, "title")
    if (!id || !headline) continue
    const parts = splitHeadline(feedText(headline))
    const descRaw = tagValue(body, "description")
    const desc = descRaw ? feedText(descRaw) : ""
    const tagsMatch = desc.match(/\s*Tags:\s*((?:\[[^\]]+\]\s*)+)$/)
    const tags = tagsMatch ? [...tagsMatch[1].matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim()) : []
    const summary = (tagsMatch ? desc.slice(0, tagsMatch.index) : desc).trim() || null
    results.push({
      id,
      title: parts.title,
      company: parts.company,
      location: parts.location,
      date: rssDate(tagValue(body, "pubDate")),
      url: postingUrl(id),
      summary,
      tags,
    })
  }
  return results
}

export function toDetail(card: JobCard): JobDetail {
  return {
    ...card,
    description: card.summary,
    employmentType: card.tags.find((t) => ENGAGEMENTS.has(t.toLowerCase())) ?? null,
  }
}

/**
 * True when `term` occurs in `hay` starting at a word boundary, so "unity"
 * matches "Unity" and "Unity3D" but not "community". Case-insensitive.
 */
function hasTerm(hay: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}`, "iu").test(hay)
}

/**
 * Client-side query matching, case-insensitive: every bare word must appear,
 * every "double-quoted phrase" must appear as written, and every -word must not.
 * Each term is anchored to the start of a word.
 */
export function matchesQuery(text: string, query: string | undefined): boolean {
  if (!query) return true
  const phrases = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean)
  const rest = query.replace(/"[^"]*"/g, " ").split(/\s+/).filter(Boolean)
  const exclude = rest.filter((w) => w.startsWith("-") && w.length > 1).map((w) => w.slice(1))
  const include = rest.filter((w) => !w.startsWith("-"))
  return (
    phrases.every((p) => hasTerm(text, p)) &&
    include.every((w) => hasTerm(text, w)) &&
    exclude.every((w) => !hasTerm(text, w))
  )
}

export function searchableText(c: JobCard): string {
  return [c.title, c.company, c.location, c.summary, c.tags.join(" ")].filter(Boolean).join(" \n ")
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
 * Accept a slug or a workwithindies.com /careers/<slug> URL. A URL on any other
 * host is rejected.
 */
export function normalizeSlug(input: string): string | null {
  const trimmed = input.trim()
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(trimmed)) return trimmed.toLowerCase()
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (!hasScheme && !/^(www\.)?workwithindies\.com\//i.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (!/^(www\.)?workwithindies\.com$/i.test(parsed.hostname)) return null
  const m = parsed.pathname.match(/^\/careers\/([a-z0-9-]+)\/?$/i)
  return m ? m[1].toLowerCase() : null
}
