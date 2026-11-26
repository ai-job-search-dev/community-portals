export const BASE_URL = "https://thehub.io"
export const USER_AGENT = "Mozilla/5.0 (compatible; thehub-cli/1.0)"
export type Format = "json" | "table" | "plain"
export type RecordData = Record<string, unknown>

export class CLIError extends Error {
  constructor(message: string, public code = "BAD_RESPONSE") { super(message) }
}
export function writeError(error: unknown): void {
  process.stderr.write(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    code: error instanceof CLIError ? error.code : "REQUEST_FAILED",
  }) + "\n")
}
export function object(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordData : {}
}
export function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null
}
/**
 * The UTC calendar date of an ISO date or timestamp. The written date is
 * validated on its own (2026-02-30 is refused), so a timestamp whose offset
 * crosses midnight UTC ("2026-01-01T00:30:00+02:00" -> 2025-12-31) still parses.
 */
export function date(value: unknown): string | null {
  const raw = text(value)
  const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/)
  if (!raw || !m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const written = new Date(Date.UTC(y, mo - 1, d))
  if (written.getUTCFullYear() !== y || written.getUTCMonth() !== mo - 1 || written.getUTCDate() !== d) return null
  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null
}
export function normalizeId(input: string): string | null {
  if (/^[a-f0-9]{24}$/i.test(input)) return input.toLowerCase()
  try {
    const url = new URL(input.startsWith("thehub.io/") || input.startsWith("www.thehub.io/") ? `https://${input}` : input)
    if (!['https:', 'http:'].includes(url.protocol) || !['thehub.io', 'www.thehub.io'].includes(url.hostname) || url.username || url.password || url.port) return null
    return url.pathname.match(/^\/jobs\/([a-f0-9]{24})\/?$/i)?.[1].toLowerCase() ?? null
  } catch { return null }
}

export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed - now) : null
}
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>
export type Getter = (path: string) => Promise<unknown | null>
export async function apiGet(path: string, deps: {
  fetch?: Fetcher; sleep?: (ms: number) => Promise<void>; random?: () => number
} = {}): Promise<unknown | null> {
  const get = deps.fetch ?? fetch
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  let waited = 0
  for (let attempt = 0; attempt <= 6; attempt++) {
    const response = await get(`${BASE_URL}/api${path}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000), redirect: "error",
    })
    if (response.status === 404) return null
    if (response.status === 429 || response.status >= 500) {
      const wait = Math.max(Math.min(500 * 2 ** attempt, 8000) + Math.floor((deps.random ?? Math.random)() * 500), retryAfterMs(response.headers.get("Retry-After")) ?? 0)
      await response.body?.cancel()
      if (attempt === 6 || waited + wait > 30_000) throw new CLIError(`The Hub returned HTTP ${response.status}; retry budget exhausted. Try later.`, "RATE_OR_SERVER_ERROR")
      await sleep(wait); waited += wait
      continue
    }
    if (!response.ok) throw new CLIError(`The Hub returned HTTP ${response.status}`, "HTTP_ERROR")
    try { return await response.json() }
    catch { throw new CLIError("The Hub returned invalid JSON", "BAD_RESPONSE") }
  }
  throw new CLIError("The Hub request failed")
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•",
  aelig: "æ", AElig: "Æ", oslash: "ø", Oslash: "Ø", aring: "å", Aring: "Å",
  // CSS punctuation and whitespace, so an encoded inline style is recognised as hidden.
  colon: ":", semi: ";", Tab: "\t", NewLine: "\n",
}
export function decodeEntities(value: string): string {
  // Numeric references decode with or without the closing semicolon, as in a
  // browser (`display&#58none` is display:none); named ones need it.
  return value.replace(/&(#x[\da-f]+;?|#\d+;?|[a-z]+;)/gi, (whole, ref: string) => {
    const key = ref.endsWith(";") ? ref.slice(0, -1) : ref
    if (!key.startsWith("#")) return ENTITIES[key] ?? whole
    const cp = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1))
    return cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : ""
  })
}
// ---------------------------------------------------------------------------
// Output hygiene (adapted from linkedin-search, same license). Posting text is
// third-party data, so markup a browser would not render is dropped before
// output: comments, <script>/<style>/<template> blocks, and elements with the
// `hidden` attribute or an inline style of display:none, visibility:hidden or
// mso-hide:all (character references in the style are decoded first), plus
// invisible Unicode. This is a best-effort filter, not a renderer: text hidden
// by a class, an external or <style> stylesheet, aria-hidden, zero size,
// off-screen positioning or matching colours is not detected and can remain.

const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip control, bidi, zero-width, variation-selector and tag characters from every string in a result. */
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
      // Browsers ignore a self-closing slash on a non-void element: count it like any opener.
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

export function cleanHtml(value: unknown): string | null {
  const html = text(value)
  if (!html) return null
  const stripped = visibleHtml(html)
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|h[1-6]|li|ul|ol)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ").replace(new RegExp(`<${ATTRS}>`, "g"), "")
  return decodeEntities(stripped).replace(/[ \t\r]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim() || null
}

const POSITION_TYPES: Record<string, string> = {
  '5b8e46b3853f039706b6ea73': 'Internship', '62e28180d8cca695ee60c98e': 'Advisory board',
  '5b8e46b3853f039706b6ea72': 'Student', '5b8e46b3853f039706b6ea74': 'Cofounder',
  '5b8e46b3853f039706b6ea70': 'Full-time', '5b8e46b3853f039706b6ea71': 'Part-time',
  '5b8e46b3853f039706b6ea75': 'Freelance',
}
export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  dateSource: string | null
  url: string
  isRemote: boolean | null
  employmentTypes: string[]
}
export function toResult(value: unknown): JobResult | null {
  const job = object(value), id = text(job.id), title = cleanHtml(job.title)
  if (!id || !/^[a-f0-9]{24}$/i.test(id) || !title) return null
  const loc = object(job.location)
  const published = date(job.publishedAt), created = date(job.createdAt)
  return {
    id, title, company: cleanHtml(object(job.company).name),
    // Location parts are third-party text too, so they go through the same cleaner.
    location: cleanHtml(loc.address) ?? ([cleanHtml(loc.locality), cleanHtml(loc.country)].filter(Boolean).join(", ") || null),
    date: published ?? created, dateSource: published ? "publishedAt" : created ? "createdAt" : null,
    url: `${BASE_URL}/jobs/${id}`, isRemote: typeof job.isRemote === 'boolean' ? job.isRemote : null,
    employmentTypes: Array.isArray(job.jobPositionTypes) ? job.jobPositionTypes.filter((v): v is string => typeof v === 'string').map(v => POSITION_TYPES[v] ?? v) : [],
  }
}
export function toDetail(value: unknown, expectedId: string) {
  const result = toResult(value), job = object(value)
  if (!result || result.id !== expectedId) throw new CLIError("The Hub returned an invalid or mismatched job detail")
  const status = text(job.status)
  return {
    ...result, description: cleanHtml(job.description), status,
    isActive: status === 'ACTIVE' ? true : status ? false : null,
    deadline: date(job.expirationDate), salary: text(job.salary), equity: text(job.equity),
    // The employer's own application link; null when the job is applied for on
    // The Hub itself (its listing page, `url`) or the link is not http(s).
    applyUrl: safeWebUrl(job.link),
  }
}
function safeWebUrl(value: unknown): string | null {
  try { const u = new URL(text(value) ?? ''); return ['https:', 'http:'].includes(u.protocol) ? u.href : null }
  catch { return null }
}
export function renderJobs(jobs: JobResult[], format: 'table' | 'plain'): string {
  if (!jobs.length) return "No results."
  if (format === 'plain') return jobs.map(j => `${j.title}\n${j.company ?? '—'} · ${j.location ?? (j.isRemote ? 'Remote' : '—')}\nDate: ${j.date ?? 'unknown'}\n${j.url}`).join('\n\n')
  return ['TITLE\tCOMPANY\tLOCATION\tDATE\tURL', ...jobs.map(j => [j.title, j.company ?? '—', j.location ?? (j.isRemote ? 'Remote' : '—'), j.date ?? 'unknown', j.url].map(v => v.replace(/[\t\n]/g, ' ')).join('\t'))].join('\n')
}
