// Data source: Kuntarekry.fi, the job board of Finnish municipalities,
// wellbeing services counties and their companies. No authentication.
//   search:  GET /fi/tyopaikat/?format=json&includeTotal=1&limit=N&desc=...  -> {jobs, total}
//   filters: GET /fi/api/filters-data/                                      -> names and ids
//   detail:  GET /fi/tyopaikat/<slug>/                                       -> HTML + JSON-LD
// robots.txt (checked 25.11.2026): "User-agent: * / Allow: /". See url-reference.md.

export const BASE_URL = "https://kuntarekry.fi"
export const USER_AGENT = "Mozilla/5.0 (compatible; kuntarekry-cli/1.0)"
export const PAGE_SIZE_MAX = 48 // the board ignores larger `limit` values (measured 25.11.2026)
export const PAGE_MAX = 999 // /sivu1000/ and up redirect to the HTML site (measured 25.11.2026)

export type Format = "json" | "table" | "plain"

export class CLIError extends Error {
  constructor(message: string, public code = "REQUEST_FAILED") {
    super(message)
  }
}

export function writeError(error: unknown): void {
  process.stderr.write(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    code: error instanceof CLIError ? error.code : "REQUEST_FAILED",
  }) + "\n")
}

export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed - now) : null
}

/**
 * GET a Kuntarekry path. Backs off with jitter on 429/5xx (at most 6 retries,
 * honouring Retry-After within a 30 s budget), returns null on 404, refuses
 * redirects (so a response can never come from another host), and times out
 * after 15 s.
 */
export async function kuntarekryGet(path: string, accept: "json" | "html"): Promise<string | null> {
  if (!path.startsWith("/")) throw new CLIError(`Refusing a non-path request: ${path}`, "BAD_ARG")
  const url = BASE_URL + path
  let delay = 500
  let waited = 0
  for (let attempt = 0; attempt <= 6; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: accept === "json" ? "application/json, text/plain;q=0.9, */*;q=0.1" : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Language": "fi,en;q=0.8",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ""
      if (name === "TimeoutError" || name === "AbortError") {
        throw new CLIError("Kuntarekry did not answer within 15 seconds", "TIMEOUT")
      }
      throw new CLIError(`Request to Kuntarekry failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (response.status === 404) {
      await response.body?.cancel()
      return null
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel()
      const backoff = delay + Math.floor(Math.random() * 500)
      const wait = Math.max(backoff, retryAfterMs(response.headers.get("Retry-After")) ?? 0)
      if (attempt === 6 || waited + wait > 30_000) {
        throw new CLIError(`Kuntarekry returned HTTP ${response.status}; retry budget exhausted, try again later`, "RATE_OR_SERVER_ERROR")
      }
      await new Promise((resolve) => setTimeout(resolve, wait))
      waited += wait
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (!response.ok) throw new CLIError(`Kuntarekry returned HTTP ${response.status}`, "HTTP_ERROR")
    return response.text()
  }
  throw new CLIError("Kuntarekry request failed after retries")
}

// ---------------------------------------------------------------------------
// Output hygiene (adapted from linkedin-search, same license). Listing text is
// third-party data, so markup a browser would not render is dropped before
// output: comments, <script>/<style>/<template> blocks, and elements with the
// `hidden` attribute or an inline style of display:none, visibility:hidden or
// mso-hide:all (character references in the style are decoded first), plus
// invisible Unicode. This is a best-effort filter, not a renderer: text hidden
// by a class, an external or <style> stylesheet, aria-hidden, zero size,
// off-screen positioning or matching colours is not detected and can remain.

const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip invisible characters from every string in a result, recursively: the CLI's output boundary. */
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
    // Browsers decode character references in attribute values before the CSS
    // is parsed, so `display&#58;none` hides exactly like `display:none`.
    const value = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "")
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) return true
  }
  return false
}

/**
 * Drop markup a browser never renders (comments, <script>/<style>/<template>
 * blocks, elements marked hidden or styled display:none) before tags are
 * stripped. An unclosed hidden element runs to the end: failing closed drops
 * visible text, failing open would leak hidden text.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    // ATTRS: a `>` or `</script>` inside a quoted attribute does not end the opening tag.
    .replace(new RegExp(String.raw`<(script|style|template)\b${ATTRS}>[\s\S]*?(?:<\/\1\s*>|$)`, "gi"), "")
  const open = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)(\\s${ATTRS})?>`, "g")
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag)) {
      // Browsers ignore a self-closing slash on a non-void element, so
      // `<span hidden/>` still opens a hidden span: count it like any opener.
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

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : ""
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", bull: "•", euro: "€", auml: "ä", Auml: "Ä", ouml: "ö", Ouml: "Ö", aring: "å", Aring: "Å",
  // CSS punctuation and whitespace, so an encoded inline style is recognised as hidden.
  colon: ":", semi: ";", Tab: "\t", NewLine: "\n",
}

export function decodeEntities(text: string): string {
  // Numeric references decode with or without the closing semicolon, as in a
  // browser (`display&#58none` is display:none); named ones need it.
  return text.replace(/&(#[xX][0-9a-fA-F]+;?|#\d+;?|[a-zA-Z]+;)/g, (whole, ref: string) => {
    const key = ref.endsWith(";") ? ref.slice(0, -1) : ref
    if (key[0] !== "#") return NAMED[key] ?? whole
    return key[1] === "x" || key[1] === "X" ? numericEntity(parseInt(key.slice(2), 16)) : numericEntity(parseInt(key.slice(1), 10))
  })
}

/** Visible text of an HTML fragment, keeping paragraph and list breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    visibleHtml(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(?:p|div|h[1-6]|ul|ol|tr|section)\s*>/gi, "\n")
      .replace(new RegExp(`<${ATTRS}>`, "g"), ""),
  )
    .replace(/[ \t\r\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** One-line visible text: for titles and short fields. */
export function inlineText(html: string | null | undefined): string | null {
  if (typeof html !== "string") return null
  const text = htmlToText(html).replace(/\s+/g, " ").trim()
  return text || null
}

// ---------------------------------------------------------------------------
// Dates. The board writes Finnish dates ("23.11.2026", "6.1.2027").

export function finnishDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const m = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return null
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

/** Today's date in Finland (Europe/Helsinki), so "posted today" means the board's today. */
export function helsinkiToday(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

/** Wall-clock time in Finland as "HH:MM" (24-hour). */
export function helsinkiClock(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Results

export interface JobResult {
  id: string
  title: string
  company: string | null
  unit: string | null
  location: string | null
  region: string | null
  date: string | null
  deadline: string | null
  employmentType: string | null
  profession: string | null
  jobKey: string | null
  url: string
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,250}[a-z0-9])?$/

/** The employer: the first segment of the profit centre ("Hämeenkyrön kunta, elinympäristöpalvelut"). */
function employer(profitCenter: string | null, organisation: string | null): string | null {
  const first = profitCenter?.split(",")[0]?.trim()
  return first || organisation
}

/** Map one row of the board's JSON list to the portal contract; null when it lacks an id, title or URL. */
export function toResult(raw: unknown): JobResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const job = raw as Record<string, unknown>
  const slug = str(job.name)
  const path = str(job.url)
  const title = inlineText(str(job.title))
  if (!slug || !SLUG.test(slug) || !title || !path || path !== `/fi/tyopaikat/${slug}/`) return null
  const profitCenter = inlineText(str(job.profit_center))
  const organisation = inlineText(str(job.organisation_title))
  const company = employer(profitCenter, organisation)
  const tags = Array.isArray(job.location_tags) ? job.location_tags.map((t) => inlineText(str(t))).filter((t): t is string => !!t) : []
  const region = inlineText(str(job.region))
  return {
    id: slug,
    title,
    company,
    unit: organisation && organisation !== company ? organisation : null,
    location: tags.length ? tags.join(", ") : region,
    region,
    date: finnishDate(job.publication_date),
    deadline: finnishDate(job.publication_end),
    employmentType: inlineText(str(job.employment_type)),
    profession: inlineText(str(job.profession)),
    jobKey: inlineText(str(job.ext_id)),
    url: BASE_URL + path,
  }
}

/** Accept a slug, a /fi/tyopaikat/<slug>/ path, or a kuntarekry.fi job URL; return the slug. */
export function normalizeJobRef(input: string): string | null {
  const value = input.trim()
  if (SLUG.test(value)) return value
  let url: URL
  try {
    url = new URL(value.startsWith("/") ? BASE_URL + value : /^(www\.)?kuntarekry\.fi\//i.test(value) ? `https://${value}` : value)
  } catch {
    return null
  }
  if (!["https:", "http:"].includes(url.protocol) || !["kuntarekry.fi", "www.kuntarekry.fi"].includes(url.hostname.toLowerCase())) return null
  if (url.username || url.password || url.port) return null
  const slug = url.pathname.match(/^\/(?:fi|sv|en)\/[a-z-]+\/([a-z0-9-]+)\/?$/i)?.[1]?.toLowerCase()
  return slug && SLUG.test(slug) ? slug : null
}

export function renderJobs(jobs: JobResult[], format: "table" | "plain"): string {
  if (!jobs.length) return "No results."
  if (format === "plain") {
    return jobs.map((j) => [
      j.title,
      `${j.company ?? "—"} · ${j.location ?? "—"}`,
      `Posted: ${j.date ?? "unknown"} · Apply by: ${j.deadline ?? "unknown"}${j.employmentType ? ` · ${j.employmentType}` : ""}`,
      j.url,
    ].join("\n")).join("\n\n")
  }
  const cell = (v: string | null) => (v ?? "—").replace(/[\t\n]+/g, " ")
  return [
    "TITLE\tEMPLOYER\tLOCATION\tPOSTED\tDEADLINE\tURL",
    ...jobs.map((j) => [j.title, j.company, j.location, j.date, j.deadline, j.url].map(cell).join("\t")),
  ].join("\n")
}
