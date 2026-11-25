// Shared helpers: fetch with backoff and a short-lived sitemap cache, a devalue
// decoder for SvelteKit __data.json payloads, HTML-to-text conversion, output
// hygiene, slug matching. Zero runtime dependencies.

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const BASE = "https://publicjobs.ch"
export const SITEMAP_URL = `${BASE}/sitemap.xml`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export const UA = "Mozilla/5.0 (compatible; publicjobs-cli/1.0)"

/** Fetch text with exponential backoff and jitter on 429/5xx. Returns "" on a 404. */
export async function fetchText(url: string, accept = "application/json,application/xml;q=0.9,*/*;q=0.8"): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "de-CH,de;q=0.9,en;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})`)
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

/**
 * The sitemap (~1.1 MB, every open posting) is the search source and /scrape
 * sends one term per call, so it is cached on disk for PUBLICJOBS_CACHE_TTL
 * seconds (default 1800; 0 disables) under PUBLICJOBS_CACHE_DIR (default: the
 * OS temp dir). Detail payloads are never cached.
 */
export async function fetchSitemapCached(): Promise<string> {
  const ttl = Number(process.env.PUBLICJOBS_CACHE_TTL ?? "1800")
  if (!Number.isFinite(ttl) || ttl <= 0) return fetchText(SITEMAP_URL, "application/xml,text/xml;q=0.9")
  const dir = process.env.PUBLICJOBS_CACHE_DIR || join(tmpdir(), "publicjobs-cli-cache")
  const file = join(dir, createHash("sha256").update(SITEMAP_URL).digest("hex").slice(0, 32) + ".xml")
  try {
    if (Date.now() - statSync(file).mtimeMs < ttl * 1000) return readFileSync(file, "utf8")
  } catch {
    // no cached copy
  }
  const body = await fetchText(SITEMAP_URL, "application/xml,text/xml;q=0.9")
  if (body) {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, body)
    } catch {
      // a cache that cannot be written is only slower, never wrong
    }
  }
  return body
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", egrave: "è",
  agrave: "à", ccedil: "ç", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»", bull: "•",
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED[name] ?? m)
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does (copied from linkedin-search): C0/C1 controls other than tab,
 * newline and CR, soft hyphen, bidi controls, zero-width characters, BOM,
 * variation selectors and Unicode tag characters.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­\u061C᠎​-\u200F\u202A-\u202E⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

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
 * Drop markup a browser never renders - comments, <script>/<style>/<template>
 * blocks, and elements marked hidden - before tags are stripped (copied from
 * linkedin-search). CSS-only tricks need a renderer and are not caught here.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  const open = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)(\\s${ATTRS})?>`, "g")
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag)) {
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

/** One line of plain text: hidden markup dropped, tags stripped, entities decoded, whitespace collapsed. */
export function clean(html: string | null | undefined): string {
  if (!html) return ""
  const stripped = visibleHtml(html).replace(new RegExp(`<${ATTRS}>`, "g"), " ")
  return decodeHtmlEntities(stripped).replace(/\s+/g, " ").trim()
}

/** Multi-line plain text that keeps paragraph, line and list boundaries. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return ""
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr|section|table)>/gi, "\n")
    .replace(/<(p|div|h\d|ul|ol|tr|section|table)\b[^>]*>/gi, "\n")
  return withBreaks
    .split("\n")
    .map((line) => {
      const bullet = line.trimStart().startsWith("- ")
      const text = clean(bullet ? line.trimStart().slice(2) : line)
      return text && bullet ? `- ${text}` : text
    })
    .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .replace(/^- $/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    // Consecutive list items stay one per line, without a blank line between them.
    .replace(/^(- .*)\n\n(?=- )/gm, "$1\n")
    .trim()
}


/** The ISO date part of an ISO timestamp; null when absent, unparsable or the Go zero time. */
export function isoDate(v: unknown): string | null {
  const m = (typeof v === "string" ? v : "").match(/^(\d{4}-\d{2}-\d{2})/)
  return m && m[1] !== "0001-01-01" ? m[1] : null
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

// ---------------------------------------------------------------------------
// devalue (SvelteKit's __data.json encoding)
// ---------------------------------------------------------------------------

/**
 * Decode one devalue-flattened array: values are stored once in a flat array
 * and every object field / array slot holds the index of its value. Negative
 * indices are special constants; ["Date", iso] style arrays are typed values.
 * Objects are registered before their fields are filled, so shared and
 * cyclic references resolve without recursion blow-ups.
 */
export function unflatten(flat: unknown): unknown {
  if (!Array.isArray(flat)) return flat
  const hydrated: unknown[] = new Array(flat.length)
  const done = new Array<boolean>(flat.length).fill(false)

  const hydrate = (index: number): unknown => {
    if (index === -1 || index === -2) return undefined
    if (index === -3) return NaN
    if (index === -4) return Infinity
    if (index === -5) return -Infinity
    if (index === -6) return -0
    if (!Number.isInteger(index) || index < 0 || index >= flat.length) return undefined
    if (done[index]) return hydrated[index]
    done[index] = true
    const v = flat[index]
    if (Array.isArray(v)) {
      if (typeof v[0] === "string") {
        const [tag, ...rest] = v as [string, ...unknown[]]
        if (tag === "Date") return (hydrated[index] = typeof rest[0] === "string" ? rest[0] : null)
        if (tag === "Set") {
          const out: unknown[] = []
          hydrated[index] = out
          for (const i of rest) out.push(hydrate(i as number))
          return out
        }
        if (tag === "Map") {
          const out: unknown[] = []
          hydrated[index] = out
          for (let i = 0; i < rest.length; i += 2) out.push([hydrate(rest[i] as number), hydrate(rest[i + 1] as number)])
          return out
        }
        if (tag === "null") {
          const out: Record<string, unknown> = {}
          hydrated[index] = out
          for (let i = 0; i < rest.length; i += 2) out[String(rest[i])] = hydrate(rest[i + 1] as number)
          return out
        }
        // RegExp, BigInt, typed arrays, custom reducers: never used for job data.
        return (hydrated[index] = null)
      }
      const out: unknown[] = []
      hydrated[index] = out
      for (const i of v) out.push(hydrate(i as number))
      return out
    }
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {}
      hydrated[index] = out
      for (const [k, i] of Object.entries(v as Record<string, unknown>)) out[k] = hydrate(i as number)
      return out
    }
    return (hydrated[index] = v)
  }
  return hydrate(0)
}

export type DataNode =
  | { type: "data"; value: Record<string, unknown> }
  | { type: "error"; error: Record<string, unknown> }
  | { type: "skip" }

export type DataPayload =
  | { type: "data"; nodes: DataNode[] }
  | { type: "redirect"; location: string }
  | { type: "error"; error: unknown }

/** Parse a SvelteKit `__data.json` response body into decoded nodes. */
export function parseDataPayload(body: string): DataPayload {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    throw new Error("publicjobs.ch returned a response that is not JSON")
  }
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.type === "redirect" && typeof r.location === "string") return { type: "redirect", location: r.location }
  if (r.type !== "data" || !Array.isArray(r.nodes)) return { type: "error", error: r.error ?? r }
  const nodes: DataNode[] = r.nodes.map((n) => {
    const node = (n ?? {}) as Record<string, unknown>
    if (node.type === "data") {
      const value = unflatten(node.data)
      return { type: "data", value: value && typeof value === "object" ? (value as Record<string, unknown>) : {} }
    }
    if (node.type === "error") return { type: "error", error: (node.error ?? {}) as Record<string, unknown> }
    return { type: "skip" }
  })
  return { type: "data", nodes }
}

// ---------------------------------------------------------------------------
// Slugs, labels and matching
// ---------------------------------------------------------------------------

/** Region slug (first path segment under /jobs) to canton name and code, from the site's own region list. */
export const REGIONS: Record<string, { name: string; code: string | null }> = {
  aargau: { name: "Aargau", code: "AG" },
  "appenzell-ausserrhoden": { name: "Appenzell Ausserrhoden", code: "AR" },
  "appenzell-innerrhoden": { name: "Appenzell Innerrhoden", code: "AI" },
  "basel-landschaft": { name: "Basel-Landschaft", code: "BL" },
  baselland: { name: "Basel-Landschaft", code: "BL" },
  "basel-stadt": { name: "Basel-Stadt", code: "BS" },
  bern: { name: "Bern", code: "BE" },
  freiburg: { name: "Freiburg", code: "FR" },
  genf: { name: "Genf", code: "GE" },
  glarus: { name: "Glarus", code: "GL" },
  graubuenden: { name: "Graubünden", code: "GR" },
  jura: { name: "Jura", code: "JU" },
  luzern: { name: "Luzern", code: "LU" },
  neuenburg: { name: "Neuenburg", code: "NE" },
  nidwalden: { name: "Nidwalden", code: "NW" },
  obwalden: { name: "Obwalden", code: "OW" },
  schaffhausen: { name: "Schaffhausen", code: "SH" },
  schweiz: { name: "Schweiz", code: null },
  schwyz: { name: "Schwyz", code: "SZ" },
  solothurn: { name: "Solothurn", code: "SO" },
  "st-gallen": { name: "St. Gallen", code: "SG" },
  tessin: { name: "Tessin", code: "TI" },
  thurgau: { name: "Thurgau", code: "TG" },
  uri: { name: "Uri", code: "UR" },
  waadt: { name: "Waadt", code: "VD" },
  wallis: { name: "Wallis", code: "VS" },
  zuerich: { name: "Zürich", code: "ZH" },
  zug: { name: "Zug", code: "ZG" },
}

/** Category slug to the site's category label. */
export const CATEGORIES: Record<string, string> = {
  "architektur-bauwesen": "Architektur / Bauwesen",
  "bildungswesen-lehrtaetigkeit-sonderpaedagogik": "Bildungswesen / Lehrtätigkeit / Sonderpädagogik",
  diverse: "Diverse",
  "energie-ingenieurwesen-verkehr": "Energie / Ingenieurwesen / Verkehr",
  "finanzen-steuern": "Finanzen / Steuern",
  "gastronomie-hauswirtschaft-hotellerie": "Gastronomie / Hauswirtschaft / Hotellerie",
  "informatik-it": "Informatik / IT",
  "kaufmaennisch-verwaltung": "Kaufmännisch / Verwaltung",
  "kinderkrippe-kinderbetreuung": "Kinderkrippe / Kinderbetreuung",
  "kirchwesen-seelsorge": "Kirchwesen / Seelsorge",
  "logistik-einkauf": "Logistik / Einkauf",
  "marketing-kommunikation-pr": "Marketing / Kommunikation / PR",
  "medizin-aerzte-pflege": "Medizin / Ärzte / Pflege",
  "ngo-npo-stiftungen": "NGO / NPO / Stiftungen",
  "oeffentliche-sicherheit-militaer-polizei": "Öffentliche Sicherheit / Militär / Polizei",
  "personalwesen-hr": "Personalwesen / HR",
  "projektmanagement-qualitaetsmanagement": "Projektmanagement / Qualitätsmanagement",
  "recht-justiz-justizvollzug": "Recht / Justiz / Justizvollzug",
  "sozialwesen-sozialarbeit": "Sozialwesen / Sozialarbeit",
  "stabsdienste-fuehrungsunterstuetzung": "Stabsdienste / Führungsunterstützung",
  "unterhalt-handwerk-aussenstellen": "Unterhalt / Handwerk / Aussenstellen",
}

export function regionLabel(slug: string): { name: string; code: string | null } {
  return REGIONS[slug] ?? { name: slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "), code: null }
}

export function categoryLabel(slug: string): string {
  return CATEGORIES[slug.toLowerCase()] ?? slug
}

/**
 * Normalise text the way the site builds its slugs, then squash the German
 * umlaut spellings so every variant meets: "Zürich", "Zuerich" and "Zurich"
 * all become "zurich"; "Steuer" becomes "steur" on both sides, so it still
 * matches. Non-alphanumerics become single spaces.
 */
export function squash(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/([aou])e/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Client-side query semantics (the sitemap is a full dump; publicjobs.ch's
 * keyword search is not reachable by GET): each whitespace-separated word must
 * appear in the searched text as a substring, after `squash` on both sides. A
 * double-quoted part must appear as an exact phrase, word order included.
 * `OR` is not an operator: it is just another word that must appear.
 */
export function matchesQuery(query: string | undefined, haystack: string): boolean {
  if (!query) return true
  const text = ` ${squash(haystack)} `
  const terms: string[] = []
  const rest = query.replace(/"([^"]+)"/g, (_, phrase: string) => {
    terms.push(squash(phrase))
    return " "
  })
  for (const w of rest.split(/\s+/)) if (w) terms.push(squash(w))
  return terms.every((t) => t === "" || text.includes(t))
}

/** "168302-database-data-engineer-80-100" title part to "Database data engineer 80 100". */
export function titleFromSlug(slug: string): string {
  const words = slug.replace(/-+/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A job path under /jobs: /<region>/<category>/<id>-<slug>. */
export const JOB_PATH = /^\/(?:fr\/)?jobs\/([a-z0-9-]+)\/([A-Za-z0-9-]+)\/(\d+)(?:-([a-z0-9-]*))?\/?$/

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  canton: string | null
  category: string | null
  date: string | null
  url: string
  slug: string
}

/**
 * Every open German-language posting from sitemap.xml. Each <url> block is
 * parsed on its own, so one malformed entry cannot break the rest. French
 * alternates (/fr/jobs/...) duplicate the German entries and are skipped.
 * The sitemap carries no posting date (its <lastmod> is a batch refresh
 * stamp) and no employer, so `date` and `company` are null: `detail` has both.
 */
export function parseSitemap(xml: string): JobCard[] {
  const seen = new Set<string>()
  const cards: JobCard[] = []
  for (const block of xml.split(/<url>/i).slice(1)) {
    try {
      const loc = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1]
      if (!loc) continue
      const u = new URL(decodeHtmlEntities(loc))
      if (u.hostname !== "publicjobs.ch" && u.hostname !== "www.publicjobs.ch") continue
      if (u.pathname.startsWith("/fr/")) continue
      const m = u.pathname.match(JOB_PATH)
      if (!m) continue
      const [, region, category, id, slug = ""] = m
      if (seen.has(id)) continue
      seen.add(id)
      const r = regionLabel(region)
      cards.push({
        id,
        title: titleFromSlug(slug) || `Posting ${id}`,
        company: null,
        location: r.name,
        canton: r.code,
        category: categoryLabel(category),
        date: null,
        url: `${BASE}${u.pathname}`,
        slug,
      })
    } catch {
      // skip a malformed entry
    }
  }
  return cards
}
