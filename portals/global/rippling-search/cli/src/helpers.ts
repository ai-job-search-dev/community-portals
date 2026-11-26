// Data source: Rippling's public job-board JSON API, served from the same
// ats.rippling.com origin as the careers pages. Reads are unauthenticated — no
// API key — and the payload is JSON, so there is no markup to parse: we reshape
// the board's postings into the portal-skill contract's result fields.
//
// Two endpoints, both scoped to one tenant ("board") slug:
//   GET /api/v2/board/<slug>/jobs?page=0&pageSize=1000   board listing (no descriptions)
//   GET /api/v1/board/<slug>/jobs/<id>                   one posting, with descriptions
//
// Rippling's list endpoint carries no company name and no posting date, which
// is why a search result's `company` is the board slug and its `date` is null.
// `detail` reads both from the single-posting endpoint.

export const CAREERS_HOST = "ats.rippling.com"
export const API_ORIGIN = `https://${CAREERS_HOST}`

/** Largest page size the board API accepts (2000 answers 400). */
export const PAGE_SIZE = 1000

// Page ceiling, independent of the board's own totalPages: a growing or
// tampered response must not turn one search into an unbounded request loop.
// PAGE_SIZE * MAX_PAGES = 10,000 listing rows; a posting with several locations
// occupies one row per location, so unique postings at the cap are fewer.
export const MAX_PAGES = 10

/** The honest UA the portal contract expects: names this tool, no browser impersonation. */
const UA = "Mozilla/5.0 (compatible; rippling-search/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** The shared error shape of Rippling's API: { error_code, message, resource }. */
interface ApiError {
  error_code?: string
  message?: string
}

// The most apiGet sleeps across all retries of one request. Its own backoff
// schedule (500ms doubling to 8s, six retries) stays under it; a Retry-After
// that would push past it fails the request at once instead, so an outage still
// degrades this source quickly rather than outlasting the caller's timeout.
const RETRY_BUDGET_MS = 30_000

/**
 * The wait a 429/503 asks for via `Retry-After`, in ms, or null when absent or
 * unreadable. Accepts both RFC 9110 forms: delta-seconds and an HTTP-date.
 */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(date - now, 0)
}

/**
 * GET JSON from the Rippling board API. Retries 429/5xx (transient server
 * states) with backoff, waiting at least as long as a `Retry-After` header asks
 * within a total budget of RETRY_BUDGET_MS; returns `null` on a 404 (an unknown
 * board or posting). A connection failure fails fast with a clear message — no
 * retry, so an outage degrades this source quickly rather than hanging.
 *
 * `redirect: "error"` keeps every request on ats.rippling.com: a redirect could
 * otherwise bounce this CLI to a host it never declared.
 */
export async function apiGet<T>(path: string): Promise<T | null> {
  const url = `${API_ORIGIN}${path}`
  const maxRetries = 6
  let delay = 500
  let waited = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      // Connection refused / DNS failure / timeout: the API is unreachable.
      throw new Error(
        `could not reach the Rippling API at ${API_ORIGIN} (${e instanceof Error ? e.message : String(e)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Rippling API request failed: ${response.status} ${response.statusText}`)
      }
      const backoff = delay + Math.floor(Math.random() * 500)
      const retryAfter = retryAfterMs(response.headers.get("Retry-After"))
      const wait = Math.max(backoff, retryAfter ?? 0)
      if (waited + wait > RETRY_BUDGET_MS) {
        throw new Error(
          `Rippling API request failed: ${response.status} ${response.statusText}; ` +
            `the server asked to retry in ${Math.ceil(wait / 1000)}s, past this CLI's ${RETRY_BUDGET_MS / 1000}s retry budget`,
        )
      }
      await sleep(wait)
      waited += wait
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null

    // Read the body once, tolerantly: an error response's JSON carries its
    // message; a 2xx must parse (a malformed one is surfaced, not swallowed).
    const body = (await response.json().catch(() => null)) as (T & ApiError) | null
    if (!response.ok) {
      throw new Error(body?.message || `Rippling API request failed: ${response.status} ${response.statusText}`)
    }
    if (!body) throw new Error("Rippling API returned an unparseable response body")
    return body
  }
  // Unreachable in practice; the loop returns or throws on the last attempt.
  throw new Error("Rippling API request failed after retries")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** A structured location on a board posting (the wire shape carries more). */
export interface BoardLocation {
  name?: string
  country?: string
  countryCode?: string
  state?: string
  city?: string
  workplaceType?: string // ON_SITE | REMOTE | HYBRID
}

/** One posting in the v2 board listing. A posting with several locations appears once per location. */
export interface BoardJob {
  id?: string
  name?: string
  url?: string
  department?: { name?: string; displayName?: string }
  locations?: BoardLocation[]
  language?: string
}

/** The v2 board listing envelope. */
export interface BoardPage {
  items?: BoardJob[]
  page?: number
  pageSize?: number
  totalItems?: number
  totalPages?: number
}

/** A posting's pay range, in the single-posting endpoint's shape. */
export interface PayRange {
  location?: string
  currency?: string
  frequency?: string // YEAR | HOUR | ...
  rangeStart?: number | null
  rangeEnd?: number | null
  isRemote?: boolean
}

/** The single-posting endpoint's fields this skill reads (the wire shape carries more). */
export interface RipplingJobDetail {
  uuid?: string
  name?: string
  description?: { company?: string; role?: string } | null
  workLocations?: string[]
  department?: { name?: string; base_department?: string }
  employmentType?: { label?: string; id?: string }
  createdOn?: string
  url?: string
  board?: { slug?: string; title?: string; companyName?: string }
  payRangeDetails?: PayRange[]
  companyName?: string
  unlistedFromSearch?: boolean
}

/** A search result in the portal-skill contract shape. Missing values are `null`, never omitted. */
export interface JobResult {
  id: string
  title: string
  company: string | null
  company_slug: string | null
  location: string | null
  locations: string[]
  date: string | null
  url: string
  department: string | null
}

/** A posting's detail: the search result plus employment type, salary and the cleaned description. */
export interface JobDetailResult extends JobResult {
  employment_type: string | null
  salary: string | null
  description: string | null
}

const SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/**
 * A board slug from a bare slug ("rippling") or a careers URL
 * ("https://ats.rippling.com/rippling/jobs"). Any other host is rejected:
 * the slug selects which tenant this CLI reads, so it must come from the board.
 */
export function companySlug(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== CAREERS_HOST) return null
    const segment = parsed.pathname.split("/").filter(Boolean)[0] ?? ""
    return SLUG_RE.test(segment) ? segment : null
  }
  return SLUG_RE.test(trimmed) ? trimmed : null
}

/** The full public URL of a posting on a board (used when a list item omits one). */
export function jobUrl(slug: string, id: string): string {
  return `${API_ORIGIN}/${slug}/jobs/${encodeURIComponent(id)}`
}

/** An absolute https posting URL host-locked to ats.rippling.com, or null. */
export function normalizeJobUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  try {
    const parsed = new URL(raw.trim())
    if (parsed.protocol !== "https:" || parsed.hostname !== CAREERS_HOST) return null
    return parsed.href
  } catch {
    return null
  }
}

/**
 * Resolve a detail reference to `{slug, id}`. Accepts a full
 * "https://ats.rippling.com/<slug>/jobs/<id>" URL, the "<slug>/<id>" id a
 * search result carries, or a bare posting id paired with `--board <slug>`.
 */
export function parseJobRef(input: string, board?: string): { slug: string; id: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== CAREERS_HOST) return null
    const match = parsed.pathname.match(/^\/([^/]+)\/jobs\/([^/]+)\/?$/)
    if (!match) return null
    const slug = match[1]
    // A malformed percent escape throws URIError; that is a bad id, not an
    // internal error, and parseJobRef runs before runDetail's try block.
    let id: string
    try {
      id = decodeURIComponent(match[2])
    } catch {
      return null
    }
    return SLUG_RE.test(slug) && ID_RE.test(id) ? { slug, id } : null
  }

  if (trimmed.includes("/")) {
    const [slug, ...rest] = trimmed.split("/")
    const id = rest.join("/")
    return SLUG_RE.test(slug) && ID_RE.test(id) ? { slug, id } : null
  }

  if (board && ID_RE.test(trimmed)) {
    const slug = companySlug(board)
    return slug ? { slug, id: trimmed } : null
  }
  return null
}

function containsWholeWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text)
}

/**
 * One location as a reader sees it: the board's own label when present (with
 * the country appended if the label omits it), else city/state/country. A
 * remote location says so once, even when the label already does.
 */
export function formatLocation(location: BoardLocation): string {
  const name = typeof location.name === "string" ? location.name.trim() : ""
  const country = typeof location.country === "string" ? location.country.trim() : ""
  const assembled = [location.city, location.state, country]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join(", ")
  let base = name ? (country && !containsWholeWord(name, country) ? `${name}, ${country}` : name) : assembled
  const remote = typeof location.workplaceType === "string" && location.workplaceType.trim().toUpperCase() === "REMOTE"
  if (remote && !containsWholeWord(base, "remote")) base = base ? `${base}, Remote` : "Remote"
  return base
}

/**
 * Collapse the v2 listing's one-item-per-location rows into one posting per id
 * (or URL when the payload has no id), merging their locations in board order.
 * Postings without a title or a host-locked URL are dropped: neither can be
 * shown or looked up.
 */
export function mergeBoardJobs(items: BoardJob[]): BoardJob[] {
  const byKey = new Map<string, BoardJob>()
  for (const item of items) {
    const id = typeof item.id === "string" ? item.id.trim() : ""
    const url = normalizeJobUrl(item.url)
    const title = typeof item.name === "string" ? item.name.trim() : ""
    // Without an id, the URL doubles as the result id, so it must be a posting
    // URL `detail` can parse — not just any page on the board host.
    const key = id || (url && parseJobRef(url) ? url : "")
    if (!key || !title || !url) continue

    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...item, name: title, url, locations: [...(item.locations ?? [])] })
    } else {
      existing.locations = [...(existing.locations ?? []), ...(item.locations ?? [])]
    }
  }
  return [...byKey.values()]
}

/** A search result row from a merged board posting. */
export function toResult(job: BoardJob, slug: string): JobResult {
  const id = String(job.id ?? "").trim()
  const locations = uniqueStrings((job.locations ?? []).map(formatLocation))
  const url = normalizeJobUrl(job.url) ?? jobUrl(slug, id)
  return {
    // A row with no id can still be opened by its URL, so use that instead of
    // emitting an id (`<slug>/`) that `detail` would reject.
    id: id ? `${slug}/${id}` : url,
    title: decodeHtmlEntities(String(job.name ?? "")).trim() || "(untitled)",
    // The list endpoint carries no company name; the board slug is the tenant
    // identity the caller searched by. `detail` reports the real company name.
    company: slug,
    company_slug: slug,
    location: locations.length ? locations.join(" · ") : null,
    locations,
    date: null, // no posting date in the list endpoint; `detail` has createdOn
    url,
    department:
      decodeHtmlEntities(job.department?.displayName ?? job.department?.name ?? "").trim() || null,
  }
}

/**
 * The portal-contract date (`YYYY-MM-DD`) from the detail endpoint's
 * `createdOn` ISO timestamp. Null when absent or not a date.
 */
export function contractDate(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? "")
  return match ? match[1] : null
}

/** A posting's detail from the v1 single-posting payload. */
export function toDetail(job: RipplingJobDetail, slug: string): JobDetailResult {
  const id = String(job.uuid ?? "").trim()
  const locations = uniqueStrings(job.workLocations)
  const company = decodeHtmlEntities(job.companyName ?? job.board?.companyName ?? "").trim()
  const descriptionParts = [cleanHtml(job.description?.company), cleanHtml(job.description?.role)].filter(
    (part): part is string => Boolean(part),
  )
  return {
    id: `${slug}/${id}`,
    title: decodeHtmlEntities(String(job.name ?? "")).trim() || "(untitled)",
    company: company || null,
    company_slug: slug,
    location: locations.length ? locations.join(" · ") : null,
    locations,
    date: contractDate(job.createdOn),
    url: normalizeJobUrl(job.url) ?? jobUrl(slug, id),
    department: decodeHtmlEntities(job.department?.name ?? "").trim() || null,
    employment_type: decodeHtmlEntities(job.employmentType?.id ?? job.employmentType?.label ?? "").trim() || null,
    salary: formatSalary(job.payRangeDetails),
    description: descriptionParts.length ? descriptionParts.join("\n\n") : null,
  }
}

function uniqueStrings(values: string[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values ?? []) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    out.push(text)
  }
  return out
}

/**
 * Human-readable pay ranges from `payRangeDetails`, or null when the posting
 * publishes none. The period is kept ("USD 185000–240000/year") because a
 * yearly figure is indistinguishable from a monthly one without it.
 */
export function formatSalary(ranges: PayRange[] | undefined): string | null {
  const parts: string[] = []
  for (const range of ranges ?? []) {
    const start = typeof range.rangeStart === "number" ? range.rangeStart : null
    const end = typeof range.rangeEnd === "number" ? range.rangeEnd : null
    if (start === null && end === null) continue
    let amount: string
    if (start !== null && end !== null) amount = `${start}–${end}`
    else if (start !== null) amount = `${start}+`
    else if (end !== null) amount = `up to ${end}`
    else continue
    const currency = typeof range.currency === "string" && range.currency.trim() ? `${range.currency.trim()} ` : ""
    const period =
      typeof range.frequency === "string" && range.frequency.trim() ? `/${range.frequency.trim().toLowerCase()}` : ""
    const where = typeof range.location === "string" && range.location.trim() ? ` (${range.location.trim()})` : ""
    parts.push(`${currency}${amount}${period}${where}`)
  }
  return parts.length ? parts.join(" · ") : null
}

/**
 * Search terms from `-q`: whitespace-separated, surrounding quotes dropped so a
 * quoted phrase still matches its words in any order. The board API has no
 * server-side keyword search, so the CLI matches terms itself.
 */
export function parseTerms(query: string | undefined): string[] {
  if (!query) return []
  return query
    .split(/\s+/)
    .map((term) => term.replace(/^["']+|["']+$/g, "").toLowerCase())
    .filter(Boolean)
}

/** Everything `-q` searches: title, department and every location label. */
export function jobSearchText(job: BoardJob): string {
  return [
    job.name,
    job.department?.name,
    job.department?.displayName,
    ...(job.locations ?? []).map(formatLocation),
  ]
    .filter((value): value is string => Boolean(value))
    // The result shows the decoded title, so match the decoded text too: a user
    // searching for "R&D" must find a posting whose raw name is "R&amp;D".
    .map((value) => decodeHtmlEntities(value))
    .join(" ")
    .toLowerCase()
}

/** Every term must appear (case-insensitive substring), like the board's own filter box. */
export function matchesTerms(job: BoardJob, terms: string[]): boolean {
  if (terms.length === 0) return true
  const haystack = jobSearchText(job)
  return terms.every((term) => haystack.includes(term))
}

const WORKPLACE_TYPES = new Set(["remote", "hybrid", "onsite"])

/**
 * Normalise a workplace type: the board's `ON_SITE`/`REMOTE`/`HYBRID` and the
 * flag's `remote`/`hybrid`/`onsite` (plus the documented `on-site`/`on_site`
 * alias) collapse to the flag's spelling. Null for anything else, so a typo
 * such as `rem-ote` is rejected instead of silently accepted.
 */
export function normalizeWorkplace(value: string): string | null {
  const token = value.trim().toLowerCase()
  if (token === "on-site" || token === "on_site") return "onsite"
  return WORKPLACE_TYPES.has(token) ? token : null
}

/**
 * Whether any of a posting's locations has one of the requested workplace
 * types. The listing is one row per location, so a posting can be onsite in one
 * city and remote in another; any match qualifies. Empty modes match all.
 */
export function matchesWorkplace(job: BoardJob, modes: string[]): boolean {
  if (modes.length === 0) return true
  const wanted = new Set(modes)
  return (job.locations ?? []).some((location) => {
    if (typeof location.workplaceType !== "string") return false
    const type = normalizeWorkplace(location.workplaceType)
    return type !== null && wanted.has(type)
  })
}

/**
 * Parse a `--remote` value: comma-separated OR, `on-site` normalises to `onsite`,
 * and a bare flag means remote. `bad` names the first value that is not a mode.
 */
export function parseWorkplaceFlag(raw: string | boolean | string[] | undefined): { modes?: string[]; bad?: string } {
  if (raw === undefined) return {}
  if (raw === true) return { modes: ["remote"] }
  if (typeof raw !== "string" || !raw.trim()) return { bad: String(raw) }
  const modes: string[] = []
  for (const part of raw.split(",")) {
    const token = part.trim()
    if (!token) continue
    const mode = normalizeWorkplace(token)
    if (mode === null) return { bad: token }
    if (!modes.includes(mode)) modes.push(mode)
  }
  return modes.length > 0 ? { modes } : { bad: raw }
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

/**
 * Decode HTML entities in one pass. Replacing `&amp;` first (or one `.replace`
 * per entity) re-scans substituted text, so `&amp;lt;` became `<` instead of
 * the literal `&lt;` it represents; a single regex leaves each other entity
 * once-decoded.
 */
function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g,
    (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (dec !== undefined) return numericEntity(parseInt(dec, 10))
      if (hex !== undefined) return numericEntity(parseInt(hex, 16))
      if (name === undefined) return whole
      const key = name.toLowerCase()
      // Own keys only: `&constructor;` must stay literal, not resolve to
      // Object's constructor through the prototype chain.
      return Object.hasOwn(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : whole
    },
  )
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 * Listing text is third-party data, and these arrive raw in a board's JSON or
 * markup as easily as through a numeric entity.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
])

/**
 * Class combinations a `<style>` block hides, from plain class selectors only.
 * `.a.b` requires both classes, so it never hides an element that has only
 * `.a`; a comma-separated list registers each part. A rule scoped by `@media` or
 * a complex selector is left alone: applying it without a CSS engine could hide
 * text the reader sees. Top-level rules are matched whole, so nested rules are
 * never mistaken for top-level ones.
 */
function stylesheetHiddenClasses(css: string): string[][] {
  const rules: string[][] = []
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "")
  let i = 0
  while (i < src.length) {
    const open = src.indexOf("{", i)
    if (open < 0) break
    const selector = src.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++
      else if (src[j] === "}") depth--
      j++
    }
    const body = src.slice(open + 1, j - 1)
    if (!selector.startsWith("@") && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(body)) {
      // A selector list is one rule; register each comma-separated part that is
      // made only of classes, keeping `.a.b` as a conjunction.
      for (const part of selector.split(",")) {
        const trimmed = part.trim()
        if (!/^(?:\.[A-Za-z_][\w-]*)+$/.test(trimmed)) continue
        const classes = [...trimmed.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1])
        if (classes.length > 0) rules.push(classes)
      }
    }
    i = j
  }
  return rules
}

/** Whether an opening tag's attributes keep it from rendering: `hidden`, an inline style, or a stylesheet-hidden class combination. */
function isHiddenTag(attrs: string, hiddenClassSets: string[][]): boolean {
  for (const match of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = match[1].toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ""
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) {
      return true
    }
    if (name === "class") {
      const tokens = new Set(value.split(/\s+/).filter(Boolean))
      for (const required of hiddenClassSets) {
        if (required.every((token) => tokens.has(token))) return true
      }
    }
  }
  return false
}

/**
 * Drop markup a browser never renders - comments (including Word's conditional
 * ones), <script>/<style>/<template> blocks, and elements marked hidden - before
 * tags are stripped. A plain tag strip keeps their text, which hands the model
 * words the posting's reader never saw.
 */
export function visibleHtml(html: string): string {
  // Read class-hiding rules only from markup a browser applies. Comments
  // (including Word/Outlook conditional ones) and inert blocks can contain a
  // <style> that never runs; using it would drop visible text.
  const withoutInert = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  const styles = [...withoutInert.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]).join("\n")
  const hiddenClassSets = stylesheetHiddenClasses(styles)
  const src = withoutInert.replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, "")
  // One pass, collecting what is kept. Quote-aware, so a `>` or a close tag
  // inside a quoted attribute is not markup.
  const tags = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[\s/](?:[^>"']|"[^"]*"|'[^']*')*)?)>/g
  const kept: string[] = []
  let from = 0
  let match: RegExpExecArray | null
  while ((match = tags.exec(src)) !== null) {
    if (match[1] || !match[3] || !isHiddenTag(match[3], hiddenClassSets)) continue
    const tag = match[2].toLowerCase()
    let end = tags.lastIndex
    // HTML ignores `/>` on a non-void element, so it opens one like `>` does.
    if (!VOID_TAGS.has(tag)) {
      // Skip to the matching close tag, counting nested same-name elements. An
      // unclosed hidden element runs to the end: failing closed drops visible
      // text, failing open would leak the hidden text.
      end = src.length
      let depth = 1
      let inner: RegExpExecArray | null
      while ((inner = tags.exec(src)) !== null) {
        if (inner[2].toLowerCase() !== tag) continue
        depth += inner[1] ? -1 : 1
        if (depth === 0) {
          end = tags.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, match.index))
    from = end
    tags.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

/**
 * Strip a posting description's HTML into readable prose: block/line-break tags
 * become newlines, entities are decoded, tags removed. Null for empty input.
 */
export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = visibleHtml(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    // Tags became spaces; an inline tag before punctuation ("<b>APIs</b>.")
    // must not leave "APIs ." in the reader's text.
    .replace(/ +([.,;:!?)\]])/g, "$1")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}
