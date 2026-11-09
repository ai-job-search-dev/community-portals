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
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
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
  // past validThrough is the fallback signal when that flag is absent.
  const expiredFlag = html.match(/"isExpired"\s*:\s*(true|false)/)
  const deadline = isoDate(str(jp.validThrough))
  const pastDeadline = deadline ? Date.parse(deadline + "T23:59:59Z") < now : false
  const isActive = (expiredFlag ? expiredFlag[1] === "false" : true) && !pastDeadline

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
