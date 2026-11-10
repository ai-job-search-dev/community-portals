// Data source: SOLID.Jobs' official public REST API (https://solid.jobs/api-ofert-pracy).
// No account, key or OAuth - only a self-chosen `campaign` identifier the portal
// uses for traffic analytics. Search is one JSON request; the API has no
// single-offer endpoint, so detail reads the offer page's schema.org JobPosting
// JSON-LD block instead (robots.txt allows both).

export const API_BASE = "https://solid.jobs/public-api/offers"
export const SITE_BASE = "https://solid.jobs"
export const CAMPAIGN = "ai-job-search-cli"

export const DIVISIONS = ["IT", "Engineering", "Marketing", "Sales", "HR", "Logistics", "Finances", "Other"]
export const EXPERIENCES = ["Intern", "Junior", "Regular", "Senior"]

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; solidjobs-cli/1.0)"

/** An HTTP failure that carries the response body, so a 400 can explain itself. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Fetch with exponential backoff and jitter on 429/5xx. Returns "" on a 404.
 * The API documents 300 requests/minute per IP and a clear 429 beyond that.
 */
export async function fetchText(url: string, accept: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new HttpError(response.status, `Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      const body = (await response.text()).trim().slice(0, 300)
      throw new HttpError(response.status, `Request failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------- output safety

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

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

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
 * Opening tag: name, then attributes. Quoted attribute values may contain `>`,
 * and HTML lets `/` separate the name from the first attribute (`<div/hidden>`),
 * so both are matched here rather than ending the tag at the first `>`.
 */
const OPEN_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[\s/](?:[^>"']|"[^"]*"|'[^']*')*)?)>/g

/**
 * Drop markup a browser never renders - comments (including Word's
 * conditional ones), <script>/<style>/<template> blocks, and elements marked
 * hidden - before tags are stripped. A plain tag strip keeps their text, which
 * hands the model words the posting's reader never saw. CSS-only tricks
 * (off-screen, zero font size) need a renderer and are not caught here.
 *
 * `/>` does not close a non-void HTML element (`<div hidden/>` stays open until
 * `</div>`), so it is treated as an ordinary opening tag; only void elements end
 * at their own tag.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  // One pass, collecting what is kept: slicing the string per hidden element
  // would make a page full of them quadratic.
  const open = new RegExp(OPEN_TAG.source, "g")
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
      const same = new RegExp(`<(/?)${tag}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, "gi")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
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

// ---------------------------------------------------------------- text

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

/** HTML description -> readable text, keeping paragraph and list breaks. */
export function htmlToText(html: string): string {
  // Markup a browser never renders (script/style/template, comments, hidden
  // elements) must not reach the output as text.
  const withBreaks = visibleHtml(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = decodeHtmlEntities(withBreaks.replace(/<\/?[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*>/g, ""))
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n(?=- )/g, "\n") // list items stay on consecutive lines
    .trim()
}

// ---------------------------------------------------------------- search

export interface Salary {
  from: number | null
  to: number | null
  currency: string | null
  period: string | null
  employmentType: string | null
}

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  workplaceType: "remote" | "hybrid" | "onsite"
  experienceLevel: string | null
  category: string | null
  subCategory: string | null
  salary: Salary | null
  secondarySalary: Salary | null
  deadline: string | null
  skills: string[]
  languages: string[]
}

interface ApiSalary {
  from?: number | null
  to?: number | null
  currency?: string | null
  period?: string | null
  employmentType?: string | null
}

interface ApiJob {
  title?: string
  category?: string | null
  subCategory?: string | null
  company?: string | null
  salary?: ApiSalary | null
  secondarySalary?: ApiSalary | null
  locations?: string[] | null
  isRemote?: boolean
  isHybrid?: boolean
  url?: string
  experienceLevel?: string | null
  skills?: { name?: string; level?: string }[] | null
  languages?: { name?: string; level?: string }[] | null
  validFrom?: string | null
  validTo?: string | null
}

export interface ApiPage {
  pageIndex: number
  pageSize: number
  totalCount: number
  totalPages: number
  jobs: unknown[]
}

/**
 * The offer's short code: `/o/<code>` is the portal's stable short link. The API
 * appends the campaign as a trailing segment (`/o/<code>/<campaign>`), which is
 * dropped so stored URLs stay campaign-free.
 */
/** An offer short code, as emitted by `search` and accepted by `detail <id>`. */
export const OFFER_CODE = /^[a-z0-9]+$/i

export function codeFromUrl(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:www\.)?solid\.jobs\/o\/([a-z0-9]+)(?:[/?#]|$)/i)
  return m ? m[1] : null
}

function salary(s: ApiSalary | null | undefined): Salary | null {
  if (!s || (s.from == null && s.to == null)) return null
  return {
    from: s.from ?? null,
    to: s.to ?? null,
    currency: s.currency ?? null,
    period: s.period ?? null,
    employmentType: s.employmentType ?? null,
  }
}

function isoDate(v: string | null | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null
}

/**
 * Map one API job. Each job is mapped independently (the API analogue of
 * chunked card parsing), so one malformed entry is skipped, never fatal.
 */
export function parseJob(raw: unknown): JobResult | null {
  if (!raw || typeof raw !== "object") return null
  const j = raw as ApiJob
  const title = typeof j.title === "string" ? decodeHtmlEntities(j.title.trim()) : ""
  const code = typeof j.url === "string" ? codeFromUrl(j.url) : null
  if (!title || !code) return null
  const locations = (Array.isArray(j.locations) ? j.locations : []).filter(
    (l): l is string => typeof l === "string" && l.trim() !== "",
  )
  const workplaceType = j.isRemote ? "remote" : j.isHybrid ? "hybrid" : "onsite"
  return {
    id: code,
    title,
    company: typeof j.company === "string" && j.company.trim() ? decodeHtmlEntities(j.company.trim()) : null,
    location: locations.length ? locations.join(", ") : workplaceType === "remote" ? "Remote" : null,
    date: isoDate(j.validFrom),
    url: `${SITE_BASE}/o/${code}`,
    workplaceType,
    experienceLevel: j.experienceLevel ?? null,
    category: j.category ?? null,
    subCategory: j.subCategory ?? null,
    salary: salary(j.salary),
    secondarySalary: salary(j.secondarySalary),
    deadline: isoDate(j.validTo),
    skills: (Array.isArray(j.skills) ? j.skills : [])
      .map((s) => s?.name)
      .filter((n): n is string => typeof n === "string"),
    languages: (Array.isArray(j.languages) ? j.languages : [])
      .filter((l) => typeof l?.name === "string")
      .map((l) => (l.level ? `${l.name} (${l.level})` : (l.name as string))),
  }
}

export function parseApiPage(body: string): { page: ApiPage; results: JobResult[] } {
  let data: ApiPage
  try {
    data = JSON.parse(body) as ApiPage
  } catch {
    throw new Error("API returned a non-JSON response")
  }
  if (!data || !Array.isArray(data.jobs)) throw new Error("API response has no jobs array")
  const results: JobResult[] = []
  for (const raw of data.jobs) {
    const job = parseJob(raw)
    if (job) results.push(job)
  }
  return { page: data, results }
}

/** Keep jobs published within `days` days. Jobs with no date are kept, never silently dropped. */
export function withinDays(job: { date: string | null }, days: number, now = Date.now()): boolean {
  if (!job.date) return true
  const t = Date.parse(job.date + "T00:00:00Z")
  if (Number.isNaN(t)) return true
  // `date` is day-granular, so compare calendar days: an offer dated on the
  // cutoff's own day may be only hours old and must be kept. Comparing its
  // midnight against now - N*24h dropped yesterday's offers under --jobage 1.
  const cutoffDay = new Date(now - days * 86400_000).toISOString().slice(0, 10)
  return job.date.slice(0, 10) >= cutoffDay
}

export function formatSalary(s: Salary | null): string {
  if (!s) return "—"
  const k = (n: number | null) => (n == null ? "?" : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))
  const unit = s.period === "Hour" ? "/h" : s.period === "Month" ? "/m" : ""
  return `${k(s.from)}-${k(s.to)} ${s.currency ?? ""}${unit} ${s.employmentType ?? ""}`.replace(/\s+/g, " ").trim()
}

// ---------------------------------------------------------------- detail

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  remote: boolean
  employmentType: string | null
  salary: Salary | null
  deadline: string | null
  experienceMonths: number | null
  skills: string[]
  description: string | null
  isActive: boolean
}

type Json = Record<string, unknown>

function asObj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null
}

/** Find the schema.org JobPosting among the page's JSON-LD blocks. */
export function extractJobPosting(html: string): Json | null {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]) as unknown
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of items) {
        const o = asObj(item)
        if (o && o["@type"] === "JobPosting") return o
      }
    } catch {
      // one malformed block must not hide the others
    }
  }
  return null
}

/** The offer's own `isExpired` flag from the page's `ng-state` JSON, or null when absent/unreadable. */
export function transferStateExpired(html: string): boolean | null {
  const m = /<script\b[^>]*\bid="ng-state"[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!m) return null
  let root: unknown
  try {
    root = JSON.parse(m[1])
  } catch {
    return null
  }
  const stack: unknown[] = [root]
  while (stack.length) {
    const v = stack.pop()
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i])
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>
      if (typeof o.isExpired === "boolean") return o.isExpired
      for (const k of Object.keys(o).reverse()) stack.push(o[k])
    }
  }
  return null
}

export function parseJobDetail(html: string, id: string, pageUrl: string, now = Date.now()): JobDetail | null {
  const jp = extractJobPosting(html)
  if (!jp) return null

  const places = Array.isArray(jp.jobLocation) ? jp.jobLocation : jp.jobLocation ? [jp.jobLocation] : []
  const cities = places
    .map((p) => str(asObj(asObj(p)?.address)?.addressLocality))
    .filter((c): c is string => c !== null)
  const remote = jp.jobLocationType === "TELECOMMUTE"

  const base = asObj(jp.baseSalary)
  const value = asObj(base?.value)
  const sal: Salary | null =
    value && (typeof value.minValue === "number" || typeof value.maxValue === "number")
      ? {
          from: typeof value.minValue === "number" ? value.minValue : null,
          to: typeof value.maxValue === "number" ? value.maxValue : null,
          currency: str(base?.currency),
          period: value.unitText === "HOUR" ? "Hour" : value.unitText === "MONTH" ? "Month" : str(value.unitText),
          employmentType: str(jp.employmentType),
        }
      : null

  const exp = asObj(jp.experienceRequirements)
  const desc = str(jp.description)
  const skills = typeof jp.skills === "string" ? jp.skills.split(",").map((s) => s.trim()).filter(Boolean) : []

  // The page's Angular transfer state carries the offer's own expiry flag; a
  // past validThrough is the fallback signal when that flag is absent. The flag
  // is read from the parsed ng-state JSON by key, never by scanning page text:
  // the offer description is employer-controlled and can contain `"isExpired"`.
  const expiredFlag = transferStateExpired(html)
  const deadline = isoDate(str(jp.validThrough))
  // Compare the full validThrough instant. A date-only value runs to the end of
  // that day (UTC); a timestamp is exact, so an offer that closed at 09:00 is
  // not reported active until midnight.
  const rawThrough = str(jp.validThrough)
  let throughMs = rawThrough ? Date.parse(rawThrough) : NaN
  if (rawThrough && /^\d{4}-\d{2}-\d{2}$/.test(rawThrough)) throughMs += 86399999
  const pastDeadline = Number.isFinite(throughMs) && throughMs < now
  const isActive = expiredFlag !== true && !pastDeadline

  return {
    id,
    title: decodeHtmlEntities(str(jp.title) ?? "(untitled)"),
    company: str(asObj(jp.hiringOrganization)?.name),
    location: cities.length ? cities.join(", ") : remote ? "Remote" : null,
    date: isoDate(str(jp.datePosted)),
    url: pageUrl,
    remote,
    employmentType: str(jp.employmentType),
    salary: sal,
    deadline,
    experienceMonths: typeof exp?.monthsOfExperience === "number" ? exp.monthsOfExperience : null,
    skills,
    description: desc ? htmlToText(desc) : null,
    isActive,
  }
}
