// Data source: Ashby's public Job Postings API
// (https://api.ashbyhq.com/posting-api/job-board/<board>), which Ashby documents
// for career sites to read their own boards. No authentication. Boards are per
// company (the slug in jobs.ashbyhq.com/<board>), and one response carries the
// whole board including descriptions, so filtering and paging are client-side.
// The company display name is not in the API payload; it is read from the
// public board page's embedded data (jobs.ashbyhq.com/<board>, a path robots.txt
// permits), falling back to the slug.

export const API_BASE = "https://api.ashbyhq.com/posting-api/job-board"
export const BOARD_PAGE_BASE = "https://jobs.ashbyhq.com"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; ashby-cli/1.0)"

/** Fetch, backing off on 429/5xx (Retry-After when sent, else exponential with jitter). Returns null on a 404. */
async function fetchWithBackoff(url: string, accept: string): Promise<Response | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      // Honor a numeric Retry-After (seconds, capped at 30); otherwise back off exponentially.
      const retryAfter = Number(response.headers.get("retry-after"))
      const wait = retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : delay + Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, wait))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    return response
  }
  throw new Error("Request failed after max retries")
}

export async function jsonFetch<T = unknown>(url: string): Promise<T | null> {
  const r = await fetchWithBackoff(url, "application/json")
  return r ? ((await r.json()) as T) : null
}

export async function htmlFetch(url: string): Promise<string> {
  const r = await fetchWithBackoff(url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
  return r ? r.text() : ""
}

// ---------------------------------------------------------------------------
// Boards and job references
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

export interface JobRef {
  board: string
  id: string
}

/**
 * Resolve a detail argument to { board, id }.
 *
 * Accepts a jobs.ashbyhq.com/<board>/<uuid>[/application] URL, any URL carrying
 * ?ashby_jid=<uuid> (company careers pages that embed Ashby) together with
 * --board, or a bare UUID with --board. Hosts are compared exactly after real
 * URL parsing, so look-alikes and userinfo tricks are rejected.
 */
export function parseJobRef(input: string, board?: string): JobRef | null {
  const trimmed = input.trim()
  if (isJobId(trimmed)) {
    return board && isValidBoard(board) ? { board, id: trimmed.toLowerCase() } : null
  }
  const hasScheme = /^https?:\/\//i.test(trimmed)
  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return null

  if (parsed.hostname.toLowerCase() === "jobs.ashbyhq.com") {
    const m = parsed.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})(?:\/application)?\/?$/i)
    if (!m) return null
    const urlBoard = decodeURIComponent(m[1])
    if (!isValidBoard(urlBoard) || !isJobId(m[2])) return null
    if (board && board.toLowerCase() !== urlBoard.toLowerCase()) return null
    return { board: urlBoard, id: m[2].toLowerCase() }
  }

  // Embedded boards on a company's own site: the board slug is not in the URL.
  const jid = parsed.searchParams.get("ashby_jid")
  if (jid && isJobId(jid) && board && isValidBoard(board)) return { board, id: jid.toLowerCase() }
  return null
}

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

export interface ApiCompComponent {
  compensationType?: string | null
  interval?: string | null
  currencyCode?: string | null
  minValue?: number | null
  maxValue?: number | null
  summary?: string | null
}

export interface ApiJob {
  id: string
  title: string
  department?: string | null
  team?: string | null
  employmentType?: string | null
  location?: string | null
  secondaryLocations?: { location?: string | null }[] | null
  publishedAt?: string | null
  isListed?: boolean | null
  isRemote?: boolean | null
  workplaceType?: string | null
  jobUrl?: string | null
  applyUrl?: string | null
  descriptionHtml?: string | null
  descriptionPlain?: string | null
  compensation?: {
    compensationTierSummary?: string | null
    scrapeableCompensationSalarySummary?: string | null
    compensationTiers?: { tierSummary?: string | null; components?: ApiCompComponent[] | null }[] | null
  } | null
}

export interface ApiBoard {
  jobs?: ApiJob[]
  apiVersion?: string
}

export async function fetchBoard(board: string): Promise<ApiBoard | null> {
  return jsonFetch<ApiBoard>(`${API_BASE}/${encodeURIComponent(board)}?includeCompensation=true`)
}

/**
 * The company's display name from the public board page's embedded
 * window.__appData (organization.name). Returns null on any failure; callers
 * fall back to the board slug.
 */
export function parseOrgName(html: string): string | null {
  const json = extractJsonObject(html, /window\.__appData\s*=\s*/)
  if (!json) return null
  try {
    const name = JSON.parse(json)?.organization?.name
    return typeof name === "string" && name.trim() ? clean(name) || null : null
  } catch {
    return null
  }
}

/**
 * The balanced {...} JSON object that starts right after `prefix`. The
 * script that assigns __appData carries more code after the object, so an
 * end-of-script anchor over-captures; brace counting (string-aware) does not.
 */
export function extractJsonObject(src: string, prefix: RegExp): string | null {
  const m = prefix.exec(src)
  if (!m) return null
  const start = m.index + m[0].length
  if (src[start] !== "{") return null
  let depth = 0
  let inString = false
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (inString) {
      if (ch === "\\") i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") depth++
    else if (ch === "}" && --depth === 0) return src.slice(start, i + 1)
  }
  return null
}

export async function fetchOrgName(board: string): Promise<string | null> {
  try {
    return parseOrgName(await htmlFetch(`${BOARD_PAGE_BASE}/${encodeURIComponent(board)}`))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Mapping to the portal-skill contract
// ---------------------------------------------------------------------------

export interface JobCard {
  id: string
  board: string
  title: string
  company: string | null
  location: string | null
  secondaryLocations: string[]
  date: string | null
  workplace: string | null
  department: string | null
  employmentType: string | null
  salary: string | null
  url: string
}

export interface PayComponent {
  type: string | null
  interval: string | null
  currency: string | null
  min: number | null
  max: number | null
}

export interface JobDetail extends JobCard {
  team: string | null
  applyUrl: string | null
  compensation: string | null
  pay: PayComponent[]
  description: string | null
  isActive: boolean
}

const WORKPLACE: Record<string, string> = { Remote: "Remote", Hybrid: "Hybrid", OnSite: "On-site" }

function workplaceOf(j: ApiJob): string | null {
  if (j.workplaceType && WORKPLACE[j.workplaceType]) return WORKPLACE[j.workplaceType]
  if (j.isRemote === true) return "Remote"
  return null
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

export function toCard(j: ApiJob, board: string, company: string | null): JobCard {
  return {
    id: j.id,
    board,
    title: clean(j.title ?? "") || "(untitled)",
    company: company ?? board,
    location: s(j.location),
    secondaryLocations: (j.secondaryLocations ?? []).map((l) => s(l?.location)).filter((l): l is string => !!l),
    date: s(j.publishedAt),
    workplace: workplaceOf(j),
    department: s(j.department),
    employmentType: s(j.employmentType),
    salary: s(j.compensation?.scrapeableCompensationSalarySummary) ?? s(j.compensation?.compensationTierSummary),
    url: s(j.jobUrl) ?? `${BOARD_PAGE_BASE}/${board}/${j.id}`,
  }
}

export function toDetail(j: ApiJob, board: string, company: string | null): JobDetail {
  const card = toCard(j, board, company)
  const pay: PayComponent[] = []
  for (const tier of j.compensation?.compensationTiers ?? []) {
    for (const c of tier?.components ?? []) {
      if (c?.minValue == null && c?.maxValue == null) continue
      pay.push({
        type: s(c.compensationType),
        interval: s(c.interval),
        currency: s(c.currencyCode),
        min: typeof c.minValue === "number" ? c.minValue : null,
        max: typeof c.maxValue === "number" ? c.maxValue : null,
      })
    }
  }
  return {
    ...card,
    team: s(j.team),
    applyUrl: s(j.applyUrl),
    compensation: s(j.compensation?.compensationTierSummary),
    pay,
    // Built from the HTML, not descriptionPlain, so hidden markup is dropped.
    description: j.descriptionHtml ? htmlToText(j.descriptionHtml) : s(j.descriptionPlain),
    // The API lists only open postings; isListed false means hidden from the board.
    isActive: j.isListed !== false,
  }
}

// ---------------------------------------------------------------------------
// Client-side filters
// ---------------------------------------------------------------------------

export function matchesLocation(card: JobCard, needle: string | undefined): boolean {
  if (!needle) return true
  const n = needle.toLowerCase()
  return [card.location, ...card.secondaryLocations].some((l) => !!l && l.toLowerCase().includes(n))
}

export const REMOTE_MODES = ["remote", "hybrid", "onsite"] as const

export function matchesWorkplace(card: JobCard, mode: string | undefined): boolean {
  if (!mode) return true
  const want = mode === "onsite" ? "On-site" : mode === "hybrid" ? "Hybrid" : "Remote"
  if (card.workplace) return card.workplace === want
  // Many boards leave workplaceType unset and say "Remote" in the location.
  if (want === "Remote") return [card.location, ...card.secondaryLocations].some((l) => !!l && /\bremote\b/i.test(l))
  return false
}

export function withinDays(date: string | null, days: number | undefined, now: Date = new Date()): boolean {
  if (days === undefined) return true
  const t = date ? Date.parse(date) : NaN
  if (Number.isNaN(t)) return false
  return now.getTime() - t <= days * 86_400_000
}

export function formatMoney(n: number | null, currency: string | null): string {
  if (n === null) return "?"
  return `${currency ?? ""} ${n.toLocaleString("en-US")}`.trim()
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
 * "&amp;lt;" must become the literal text "&lt;", never "<", and a double-escaped
 * "&amp;mdash;" must come out as the text "&mdash;".
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, name: string) => {
    if (name[0] === "#") {
      const hex = name[1] === "x" || name[1] === "X"
      return numericEntity(parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10))
    }
    return NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? whole
  })
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab/newline/CR, the soft hyphen, bidi
 * marks/embeddings/overrides/isolates, zero-width characters and invisible
 * operators, the BOM, variation selectors, and Unicode tag characters.
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

function stripTags(html: string): string {
  return visibleHtml(html).replace(new RegExp(`<${ATTRS}>`, "g"), " ").replace(/\s+/g, " ").trim()
}

export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/** Render description HTML as text, keeping paragraph and list-item breaks. */
export function htmlToText(html: string): string | null {
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    // Inline formatting tags vanish without a space, so "<b>API</b>." stays "API.".
    .replace(/<\/?(b|strong|i|em|u|span|a|font|small|sup|sub)\b[^>]*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    // </li> adds no break of its own: the next <li> (or </ul>) supplies it.
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|ul|ol|div|h\d)>/gi, "\n")
  const text = withBreaks
    .split("\n")
    .map(clean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    // Ashby wraps list items in <p>, which leaves a blank line between every
    // bullet; keep consecutive bullets on consecutive lines.
    .replace(/\n\n(?=- )/g, (gap, offset: number, whole: string) => {
      const prevLine = whole.slice(whole.lastIndexOf("\n", offset - 1) + 1, offset)
      return prevLine.startsWith("- ") ? "\n" : gap
    })
    .trim()
  return text || null
}


/** Lowercased word tokens (letters/digits), for title matching. */
function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter(Boolean)
}

/**
 * Client-side keyword match: every query word must appear as a word in the
 * title. "Principal Product Manager" therefore matches "Principal / Lead
 * Product Manager, Carrier Connectivity" but not "Product Manager".
 */
export function titleMatches(title: string, query: string | undefined): boolean {
  if (!query) return true
  const have = new Set(tokens(title))
  return tokens(query).every((t) => have.has(t))
}
