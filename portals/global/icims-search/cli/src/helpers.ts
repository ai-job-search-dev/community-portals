// Data source: iCIMS hosted career portals (*.icims.com). Every employer gets
// its own portal subdomain (careers-<company>, jobs-<company>, ...), so search
// and detail both name one portal. The search page is server-rendered HTML with
// no public JSON API: the CLI parses its job cards and sends the keyword to
// iCIMS's own search. A posting's full text and posted date come from the
// schema.org JobPosting JSON-LD on its detail page, with the page markup as the
// fallback for portals that emit no JSON-LD.

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; icims-cli/1.0)"

/** Retry policy for htmlFetch; tests pass a fast one. */
export interface RetryPolicy {
  maxRetries: number
  baseDelayMs: number
  /** Total sleep allowed across retries; defaults to RETRY_BUDGET_MS. */
  budgetMs?: number
}
const DEFAULT_RETRY: RetryPolicy = { maxRetries: 6, baseDelayMs: 500 }

// The most htmlFetch sleeps across all retries of one request. A Retry-After
// that would push past it fails the request at once instead, so a throttling
// portal degrades this source quickly rather than outlasting the caller's tool
// timeout.
const RETRY_BUDGET_MS = 30_000

// Redirects are followed by hand: fetch's "follow" would let a portal (or
// anything that compromised it) point this CLI at an arbitrary host, which
// breaks the "only the declared board" rule and allows SSRF. Each Location must
// stay on an iCIMS host and on a /jobs path; anything else is refused.
const MAX_REDIRECTS = 5

/** Sleep budget and backoff carried across redirect hops, so a chain cannot reset them. */
interface FetchState {
  delay: number
  waited: number
}

/** Fetch an HTML page, backing off on 429/5xx (Retry-After when sent, else exponential with jitter). Returns null on a 404/410 (unknown portal, or a closed posting). */
export async function htmlFetch(
  url: string,
  retry: RetryPolicy = DEFAULT_RETRY,
  redirectsLeft = MAX_REDIRECTS,
  state?: FetchState,
): Promise<string | null> {
  const { maxRetries } = retry
  const budget = retry.budgetMs ?? RETRY_BUDGET_MS
  const shared = state ?? { delay: retry.baseDelayMs, waited: 0 }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) throw new Error(`Request failed: ${response.status} redirect without a Location header`)
      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        throw new Error(`Request failed: ${response.status} redirect to an unreadable location`)
      }
      if (redirectsLeft <= 0) throw new Error(`Request failed: too many redirects (last: ${next.href})`)
      if (
        next.protocol !== "https:" ||
        next.username ||
        next.password ||
        !isIcimsHost(next.hostname) ||
        !/^\/jobs(?:\/|$)/.test(next.pathname)
      ) {
        throw new Error(`Refusing to follow a redirect off the iCIMS portal: ${next.origin}${next.pathname}`)
      }
      return htmlFetch(next.href, retry, redirectsLeft - 1, shared)
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      // Honor a numeric Retry-After (seconds, capped at 30); otherwise back off exponentially.
      const retryAfter = Number(response.headers.get("retry-after"))
      const wait = retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : Math.min(shared.delay + Math.floor(Math.random() * shared.delay), 8000)
      if (shared.waited + wait > budget) {
        throw new Error(
          `Request failed: ${response.status} ${response.statusText}; ` +
            `the server asked to retry in ${Math.ceil(wait / 1000)}s, past this CLI's ${budget / 1000}s retry budget`,
        )
      }
      await new Promise((r) => setTimeout(r, wait))
      shared.waited += wait
      shared.delay = Math.min(shared.delay * 2, 8000)
      continue
    }
    if (response.status === 404 || response.status === 410) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return await response.text()
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Portals and job references
// ---------------------------------------------------------------------------

const LABEL_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/i
const HOST_RE = /^([a-z0-9][a-z0-9_-]*)\.icims\.com$/i

/** True for a host owned by iCIMS, which is the only host this CLI calls. */
export function isIcimsHost(host: string): boolean {
  return HOST_RE.test(host)
}

export interface PortalRef {
  origin: string
  host: string
  /** The portal's host label, e.g. "careers-usu" (used as `company`). */
  label: string
}

/**
 * Resolve --portal to a portal origin.
 *
 * Accepts the portal's host label (`careers-usu`) or a URL on the portal
 * (the homepage, or any `/jobs...` page). Hosts are compared after real URL
 * parsing, so only `*.icims.com` is reachable and look-alike hosts
 * (icims.com.evil.io, icims.com@evil.io) fall on the reject side. The path
 * carries no meaning: the host is the portal.
 */
export function parsePortal(input: string): PortalRef | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (LABEL_RE.test(trimmed)) {
    const label = trimmed.toLowerCase()
    const host = `${label}.icims.com`
    return { origin: `https://${host}`, host, label }
  }
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null
  const match = HOST_RE.exec(parsed.hostname)
  if (!match) return null
  return { origin: `https://${parsed.hostname}`, host: parsed.hostname, label: match[1].toLowerCase() }
}

/**
 * The portal's search page. `pr` is iCIMS's 0-based page index; the CLI's
 * `--page` is 1-indexed. `in_iframe=1` selects the portal-only markup without
 * the employer's page chrome. A query goes to iCIMS's own keyword search, which
 * is the only keyword surface the portal has; location and age are client-side.
 */
export function searchUrl(origin: string, page: number, query?: string): string {
  const url = new URL("/jobs/search", origin)
  url.searchParams.set("ss", "1")
  url.searchParams.set("pr", String(page - 1))
  url.searchParams.set("in_iframe", "1")
  if (query) {
    url.searchParams.set("searchKeyword", query)
    url.searchParams.set("searchRelation", "keyword_all")
  }
  return url.href
}

export interface JobRef {
  id: string
  /** The posting page to fetch, always with `in_iframe=1`. */
  url: string
  company: string
}

/**
 * Resolve a detail argument to a posting.
 *
 * Accepts a posting URL (`/jobs/<id>/<slug>/job`, slug optional, query
 * stripped) or a numeric ID together with --portal. The URL's own host wins so
 * a portal alias keeps working: some search pages link postings on a sibling
 * host (`careersat-ohsu` → `externalcareers-ohsu`). Only `*.icims.com` is ever
 * fetched.
 */
export function resolveJobRef(input: string, portal?: PortalRef): JobRef | null {
  const trimmed = input.trim()
  if (/^\d{1,12}$/.test(trimmed)) {
    if (!portal) return null
    return { id: trimmed, url: `${portal.origin}/jobs/${trimmed}/job?in_iframe=1`, company: portal.label }
  }
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !isIcimsHost(parsed.hostname)) return null
  const match = parsed.pathname.match(/^\/jobs\/(\d+)\/(?:[^/]+\/)*job\/?$/)
  if (!match) return null
  return {
    id: match[1],
    url: `${parsed.origin}${parsed.pathname}?in_iframe=1`,
    company: HOST_RE.exec(parsed.hostname)?.[1].toLowerCase() ?? parsed.hostname,
  }
}

// ---------------------------------------------------------------------------
// HTML text hygiene (kept in step with community-portals lever-search helpers.ts)
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

/** Decode one layer of HTML entities in a single pass, so "&amp;lt;" stays the literal text "&lt;". */
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

// Inline tags wrap words without separating them: replacing `<strong>` with a
// space turned "students." into "students .".
const INLINE_TAGS = /<\/?(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)\b[^>]*>/gi

function cleanLine(html: string): string {
  return decodeHtmlEntities(html.replace(INLINE_TAGS, "").replace(new RegExp(`<${ATTRS}>`, "g"), " "))
    .replace(/[ \t ]+/g, " ")
    .trim()
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

/** Text of a short markup fragment (a label or a field value), on one line. */
function inlineText(html: string): string {
  return cleanLine(html.replace(/<[^>]+>/g, " "))
}

// ---------------------------------------------------------------------------
// Search page parsing
// ---------------------------------------------------------------------------

export type Workplace = "remote" | "hybrid" | "onsite"

export interface JobCard {
  id: string
  title: string
  company: string
  location: string | null
  date: string | null
  url: string
  workplace: Workplace | null
}

export interface SearchPage {
  jobs: JobCard[]
  /** "Search Results Page 1 of N" as printed by the portal; null when it prints none (e.g. zero results). */
  totalPages: number | null
}

interface HeaderField {
  label: string
  value: string
}

/** A portal-declared workplace mode, in the same vocabulary Lever uses. */
export function normalizeWorkplace(value: string | null | undefined): Workplace | null {
  const v = stripInvisible(String(value ?? "")).trim().toLowerCase()
  if (v === "remote" || v === "telecommute" || v === "telework") return "remote"
  if (v === "hybrid") return "hybrid"
  if (/^on[-_ ]?site$/.test(v)) return "onsite"
  return null
}

const TELEWORK_LABEL = /telework|remote|workplace|work arrangement|work type|location type/i
const REMOTE_WORD_RE = /(?<![\p{L}\p{M}\p{N}])remote(?![\p{L}\p{M}\p{N}])/iu

/**
 * The workplace value the card's own header fields declare, if any. iCIMS has
 * no fixed workplace field: some portals print "Telework Eligible: Hybrid" or
 * "Remote: Yes", others print nothing. A negative telework/remote value means
 * the posting is on-site, which is what "Telework Eligible: No" says.
 */
function fieldWorkplace(fields: HeaderField[]): Workplace | null {
  for (const field of fields) {
    // Strip before matching: a zero-width character can spell "Hyb​rid" yet
    // read as "Hybrid", and would otherwise make the filter miss it.
    const label = stripInvisible(field.label)
    const value = stripInvisible(field.value).trim()
    if (!TELEWORK_LABEL.test(label)) continue
    const mode = normalizeWorkplace(value)
    if (mode) return mode
    if (/^(no|false)$/i.test(value)) return "onsite"
    if (/^(yes|true)$/i.test(value) && /remote/i.test(label)) return "remote"
  }
  return null
}

/** A location that says "Remote" (e.g. "US-Remote") is the only fallback iCIMS gives. */
function locationWorkplace(location: string | null): Workplace | null {
  return location && REMOTE_WORD_RE.test(stripInvisible(location)) ? "remote" : null
}

/** Client-side workplace filter; a posting with no declared mode cannot match. */
export function matchesWorkplace(card: JobCard, wanted: Workplace | undefined): boolean {
  if (!wanted) return true
  return card.workplace === wanted
}

/**
 * The `<dt>label</dt><dd>value</dd>` pairs under a card's or posting's
 * `additionalFields` block. Tenants choose the labels and their order, so
 * callers match on the label text rather than a position.
 */
function headerFields(html: string): HeaderField[] {
  const fields: HeaderField[] = []
  const re = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    fields.push({ label: inlineText(m[1]), value: inlineText(m[2]) })
  }
  return fields
}

/** A location string the portal prints, or null for an empty/placeholder one. */
function cleanPlace(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim()
  if (!text || /^(unavailable|n\/?a)$/i.test(text)) return null
  return text
}

function fieldValue(fields: HeaderField[], label: RegExp): string | null {
  for (const field of fields) {
    if (label.test(field.label)) {
      const value = cleanPlace(field.value)
      if (value) return value
    }
  }
  return null
}

/** The first `<a href>` in a card that points at a job page on an iCIMS host. */
function findJobLink(card: string, origin: string): { id: string; url: string } | null {
  const re = /<a\b[^>]*\bhref=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(card)) !== null) {
    let parsed: URL
    try {
      parsed = new URL(decodeHtmlEntities(m[1]), origin)
    } catch {
      continue
    }
    if (parsed.protocol !== "https:" || !isIcimsHost(parsed.hostname)) continue
    const path = parsed.pathname.match(/^\/jobs\/(\d+)\/(?:[^/]+\/)*job\/?$/)
    if (!path) continue
    return { id: path[1], url: `${parsed.origin}${parsed.pathname}` }
  }
  return null
}

/**
 * The card's location. Tenants put it either in the `additionalFields` list
 * ("Job Location", "Location", "Job Locations") or in the card's header strip
 * under a "Location"/"City" field label; the first with a value wins. A
 * "Facility" label is deliberately not a location (some portals print the
 * hospital name there).
 */
function cardLocation(card: string, fields: HeaderField[]): string | null {
  const fromFields = fieldValue(fields, /location/i)
  if (fromFields) return fromFields
  const header = card.match(
    /<span\b[^>]*class=["'][^"']*(?<![\w-])field-label(?![\w-])[^"']*["'][^>]*>\s*(?:City|Location(?:\s*:\s*\w+)?)\s*<\/span>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i,
  )
  return header ? cleanPlace(inlineText(header[1])) : null
}

/**
 * A portal date (`11/25/2026 4:02 PM`) as YYYY-MM-DD, or null. iCIMS prints the
 * date in the portal's own locale; a day and month both <= 12 is read as
 * M/D (the en-US default), which is what every sampled portal used.
 */
function portalDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value.trim())
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  const month = a > 12 ? b : a
  const day = a > 12 ? a : b
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** The card's "Posted Date" value (its `title` attribute carries the full date). */
function cardDate(card: string): string | null {
  const m = card.match(
    /<span\b[^>]*class=["'][^"']*(?<![\w-])field-label(?![\w-])[^"']*["'][^>]*>\s*Posted Date\s*<\/span>[\s\S]{0,600}?<span\b[^>]*\btitle=["']([^"']+)["']/i,
  )
  return m ? portalDate(m[1]) : null
}

/**
 * Parse one search-results page. Cards are `<li class="iCIMS_JobCardItem">`
 * blocks; splitting on that token keeps one malformed card from breaking the
 * rest. Postings are only kept when they link a job page on an iCIMS host.
 */
export function parseSearchPage(html: string, origin: string, company: string): SearchPage {
  const jobs: JobCard[] = []
  for (const card of String(html).split("iCIMS_JobCardItem").slice(1)) {
    const link = findJobLink(card, origin)
    if (!link) continue
    // The h3 may carry attributes: tenants theme their portals.
    const heading = card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)
    let title = heading ? htmlToText(heading[1]).replace(/\n+/g, " ") : ""
    if (!title) {
      const anchor = card.match(/<a\b[^>]*\btitle=["']([^"']+)["']/i)
      // The title is an attribute, so entities arrive raw ("R&amp;D"); decode
      // it the same way as the h3 path.
      title = anchor ? decodeHtmlEntities(anchor[1]).replace(/^\d+\s*-\s*/, "").trim() : ""
    }
    if (!title) continue
    const fields = headerFields(card)
    const location = cardLocation(card, fields)
    jobs.push({
      id: link.id,
      title,
      company,
      location,
      date: cardDate(card),
      url: link.url,
      workplace: fieldWorkplace(fields) ?? locationWorkplace(location),
    })
  }
  const total = String(html).match(/Search Results\s+Page\s+\d+\s+of\s+(\d+)/i)
  return { jobs, totalPages: total ? Number(total[1]) : null }
}

// ---------------------------------------------------------------------------
// Posting page parsing
// ---------------------------------------------------------------------------

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  requisitionId: string | null
}

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = []
  // `type` is not reliably the first attribute: a portal running CSP emits a
  // nonce on every inline script, so the type check may not anchor the tag.
  const re = /<script\b[^>]*(?<![\w-])type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const [, raw] of String(html).matchAll(re)) {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      continue
    }
    if (Array.isArray(data)) nodes.push(...(data as Record<string, unknown>[]))
    else if (Array.isArray((data as { "@graph"?: unknown })?.["@graph"])) {
      nodes.push(...((data as { "@graph": Record<string, unknown>[] })["@graph"]))
    } else if (data && typeof data === "object") nodes.push(data as Record<string, unknown>)
  }
  return nodes
}

function isJobPosting(node: unknown): boolean {
  const type = (node as { "@type"?: unknown } | null)?.["@type"]
  return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/**
 * "Locality, Region, Country" from the JobPosting address. iCIMS writes the
 * literal string UNAVAILABLE into fields it has no value for, and some
 * postings carry an all-UNAVAILABLE place before the real one.
 */
function addressLocation(node: Record<string, unknown> | undefined): string | null {
  const raw = node?.jobLocation
  const places = Array.isArray(raw) ? raw : raw ? [raw] : []
  for (const place of places) {
    const address = (place as { address?: Record<string, unknown> } | null)?.address
    if (!address || typeof address !== "object") continue
    const clean = (value: unknown) => {
      const s = String(value ?? "").trim()
      return !s || /^unavailable$/i.test(s) ? "" : s
    }
    const parts = [clean(address.addressLocality), clean(address.addressRegion), clean(address.addressCountry)].filter(
      Boolean,
    )
    if (parts.length) return parts.join(", ")
  }
  return null
}

function employmentType(value: unknown): string | null {
  const values = (Array.isArray(value) ? value : [value])
    .map((v) => text(v))
    .filter((v): v is string => v !== null && !/^(other|unavailable)$/i.test(v))
  return values.length ? values.join(", ") : null
}

/**
 * The visible posting body from page markup, for portals with no JSON-LD.
 * The body starts at the first job content block and ends at the Options/Apply
 * block, which would otherwise add navigation chrome to the text.
 */
function pageBody(html: string): string | null {
  const source = String(html)
  const token = source.search(/iCIMS_InfoMsg_Job/i)
  if (token < 0) return null
  // Back up to the opening `<` of the containing tag: starting at the class
  // token would cut the tag in half and hand the stripper a broken attribute.
  const start = Math.max(0, source.lastIndexOf("<", token))
  const rest = source.slice(start)
  const endToken = rest.search(/iCIMS_JobOptions|iCIMS_SubHeader_Job["'][^>]*>\s*Options/i)
  const end = endToken < 0 ? rest.length : Math.max(0, rest.lastIndexOf("<", endToken))
  const body = htmlToText(rest.slice(0, end))
  return body || null
}

/**
 * Parse a posting page. Returns null when the page carries no posting at all
 * (a closed job or a bad slug renders the portal's error/list page instead).
 */
export function parseJobPage(html: string, url: string, company: string): JobDetail | null {
  const nodes = jsonLdNodes(html)
  const posting = nodes.find(isJobPosting) ?? nodes.find((n) => n && typeof n === "object" && n.datePosted && n.description)
  const heading = String(html).match(/<h1\b[^>]*class=["'][^"']*iCIMS_Header[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)
  const title = text(posting?.title) ?? (heading ? htmlToText(heading[1]) : "")
  if (!title) return null

  const fields = headerFields(html)
  const id = url.match(/\/jobs\/(\d+)\//)?.[1] ?? ""
  const description = text(posting?.description)
  const location = addressLocation(posting) ?? fieldValue(fields, /location/i)
  return {
    id,
    title,
    company,
    location,
    date: portalDate(text(posting?.datePosted) ?? "") ?? cardDate(html),
    url: url.replace(/\?.*$/, ""),
    description: description ? htmlToText(description) || null : pageBody(html),
    employmentType: employmentType(posting?.employmentType),
    requisitionId: fieldValue(fields, /^(requisition\s*)?id$/i),
    workplace: jsonLdWorkplace(posting) ?? fieldWorkplace(fields) ?? locationWorkplace(location),
  }
}

/** schema.org `jobLocationType: "TELECOMMUTE"` when a portal publishes it. */
function jsonLdWorkplace(node: Record<string, unknown> | undefined): Workplace | null {
  const value = node?.jobLocationType
  return typeof value === "string" && /telecommute/i.test(stripInvisible(value)) ? "remote" : null
}

// ---------------------------------------------------------------------------
// Client-side filters
// ---------------------------------------------------------------------------

/** Case-insensitive substring match on the posting's location. */
export function matchesLocation(location: string | null, wanted: string | undefined): boolean {
  if (!wanted) return true
  return (location ?? "").toLowerCase().includes(wanted.toLowerCase())
}

/** Clock-skew allowance for a full timestamp slightly ahead of this machine's clock. */
const FUTURE_SKEW_MS = 60 * 60 * 1000
// A card date is a calendar day, not an instant ("2026-11-25" parses as
// midnight UTC). A portal's local date can be a day ahead of the reader's UTC
// clock, so a day of allowance keeps "today" cards from reading as future.
const DATE_ONLY_SKEW_MS = 24 * 60 * 60 * 1000
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Posted within N days. A portal that does not print a posted date on its
 * search cards yields null; the caller decides whether an undated card passes,
 * because a date filter cannot judge one. A date further in the future than the
 * skew allowance fails, rather than passing every cutoff with a negative age.
 */
export function withinDays(date: string | null, days: number | undefined, now = Date.now()): boolean {
  if (!days) return true
  if (!date) return false
  const t = Date.parse(date)
  if (Number.isNaN(t)) return false
  const age = now - t
  const skew = DATE_ONLY.test(date) ? DATE_ONLY_SKEW_MS : FUTURE_SKEW_MS
  return age >= -skew && age <= days * 86400000
}
