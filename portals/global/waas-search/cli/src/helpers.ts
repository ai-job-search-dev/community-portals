// Helpers and fetch utilities for Y Combinator Work at a Startup (waas-search)
// Endpoints are unauthenticated and public.
// Server-rendered pages provide Inertia.js data-page attributes; search queries
// query /jobs/search?q=... used by the web interface.

export const BASE_URL = "https://www.workatastartup.com"
export const JOBS_URL = "https://www.workatastartup.com/jobs"
export const SEARCH_API_URL = "https://www.workatastartup.com/jobs/search"
export const UA = "Mozilla/5.0 (compatible; waas-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

/** Fetch JSON with exponential backoff on 429/5xx. Returns null on 404. */
export async function jsonFetch<T = unknown>(url: string): Promise<T | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
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
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
  }
  throw new Error("Request failed after max retries")
}

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
}

/** Unescape standard HTML entities in a single pass without third-party dependencies */
export function unescapeHtml(str: string): string {
  return str.replace(
    /&(?:(quot|amp|lt|gt|apos)|#(\d+)|#[xX]([0-9a-fA-F]+));/g,
    (match, named, dec, hex) => {
      if (named) {
        return NAMED_ENTITIES[named] ?? match
      }
      if (dec) {
        const code = parseInt(dec, 10)
        if (code >= 0 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code)
          } catch {
            return match
          }
        }
        return match
      }
      if (hex) {
        const code = parseInt(hex, 16)
        if (code >= 0 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code)
          } catch {
            return match
          }
        }
        return match
      }
      return match
    },
  )
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 */
export const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from string or object/array recursively */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

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

export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  const tags = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[\s/](?:[^>"']|"[^"]*"|'[^']*')*)?)>/g
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = tags.exec(src)) !== null) {
    if (m[1] || !m[3] || !isHiddenTag(m[3])) continue
    const tag = m[2].toLowerCase()
    let end = tags.lastIndex
    if (!VOID_TAGS.has(tag)) {
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = tags.exec(src)) !== null) {
        if (s[2].toLowerCase() !== tag) continue
        depth += s[1] ? -1 : 1
        if (depth === 0) {
          end = tags.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    tags.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

/** Convert raw HTML snippet into clean readable plain text with preserved paragraphs */
export function htmlToPlain(html: string | null | undefined): string {
  if (!html) return ""
  let t = visibleHtml(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*\/div\s*>/gi, "\n\n")
    .replace(/<\s*\/li\s*>/gi, "\n")
    .replace(/<\s*li\s*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
  t = unescapeHtml(t)
  const lines = t.split("\n").map((l) => l.trim())
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  return stripInvisible(text)
}

/** Extract Inertia.js data-page payload from HTML */
export function parseDataPage(html: string): any {
  const match = html.match(/data-page="([^"]+)"/) || html.match(/data-page='([^']+)'/)
  if (!match) return null
  try {
    const unescaped = unescapeHtml(match[1])
    return JSON.parse(unescaped)
  } catch {
    return null
  }
}

export interface RawJob {
  id: number | string
  title: string
  jobType?: string | null
  location?: string | null
  roleType?: string | null
  salary?: string | null
  companyName?: string | null
  companySlug?: string | null
  companyBatch?: string | null
  companyOneLiner?: string | null
  companyLogoUrl?: string | null
  companyLastActiveAt?: string | null
  applyUrl?: string | null
}

export interface WaasJobCard {
  id: string
  title: string
  company: string
  batch: string | null
  location: string | null
  remote: boolean
  category: string | null
  salary: string | null
  date: string | null
  url: string
}

export interface WaasJobDetail extends WaasJobCard {
  equity: string | null
  jobType: string | null
  minExperience: string | null
  sponsorsVisa: string | null
  skills: string[]
  description: string | null
  companyDescription: string | null
  techDescription: string | null
  hiringDescription: string | null
  companyUrl: string | null
  teamSize: number | null
  applyUrl: string | null
}

export function validateApplyUrl(urlStr: unknown): string | null {
  if (typeof urlStr !== "string" || !urlStr.trim()) return null
  try {
    const parsed = new URL(urlStr.trim(), BASE_URL)
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href
    }
  } catch {
    return null
  }
  return null
}

export function mapRawToCard(raw: RawJob): WaasJobCard {
  const idStr = String(raw.id)
  const loc = raw.location || ""
  const isRemote = /\bremote\b/i.test(loc)
  // Search results are third-party text too: strip invisible characters here so a
  // listing cannot hide instructions from a model reading the JSON output.
  return stripInvisible({
    id: idStr,
    title: raw.title || "",
    company: raw.companyName || "",
    batch: raw.companyBatch || null,
    location: raw.location || null,
    remote: isRemote,
    category: raw.roleType || null,
    salary: raw.salary || null,
    date: raw.companyLastActiveAt || null,
    url: `${BASE_URL}/jobs/${idStr}`,
  })
}

export interface SearchFilters {
  query?: string
  remote?: boolean
  limit?: number
}

/**
 * Fetch jobs matching filters.
 * Hits https://www.workatastartup.com/jobs?query=...&remote=true (server-rendered page)
 * and /jobs/search?q=... for full keyword search results.
 */
export async function fetchJobs(filters: SearchFilters): Promise<WaasJobCard[]> {
  const jobsMap = new Map<string, WaasJobCard>()
  const caughtErrors: unknown[] = []

  // 1. Fetch server-rendered /jobs page (with query/remote query params)
  const pageParams = new URLSearchParams()
  if (filters.query && filters.query.trim()) pageParams.set("query", filters.query.trim())
  if (filters.remote) pageParams.set("remote", "true")
  const pageUrl = `${JOBS_URL}${pageParams.toString() ? `?${pageParams.toString()}` : ""}`

  try {
    const html = await htmlFetch(pageUrl)
    if (html) {
      const data = parseDataPage(html)
      const pageJobs = data?.props?.jobs
      if (Array.isArray(pageJobs)) {
        for (const j of pageJobs) {
          const card = mapRawToCard(j)
          jobsMap.set(card.id, card)
        }
      }
    }
  } catch (err) {
    caughtErrors.push(err)
  }

  // 2. If query is provided, also query /jobs/search which searches across all YC jobs
  if (filters.query && filters.query.trim()) {
    try {
      const searchUrl = `${SEARCH_API_URL}?q=${encodeURIComponent(filters.query.trim())}`
      const searchData = await jsonFetch<{ jobs?: RawJob[] }>(searchUrl)
      if (searchData?.jobs && Array.isArray(searchData.jobs)) {
        for (const j of searchData.jobs) {
          const card = mapRawToCard(j)
          jobsMap.set(card.id, card)
        }
      }
    } catch (err) {
      caughtErrors.push(err)
    }
  }

  if (jobsMap.size === 0 && caughtErrors.length > 0) {
    throw caughtErrors[0]
  }

  let cards = Array.from(jobsMap.values())

  // If query is provided, filter client-side to ensure query relevance
  if (filters.query && filters.query.trim()) {
    const qRaw = filters.query.trim().toLowerCase()
    const words = qRaw.split(/\s+/).filter(Boolean)
    const normQuery = qRaw.replace(/front[\s-]end/g, "frontend")

    cards = cards.filter((c) => {
      const target = `${c.title} ${c.category || ""} ${c.company}`.toLowerCase()
      const normTarget = target.replace(/front[\s-]end/g, "frontend")
      if (normTarget.includes(normQuery)) return true
      return words.every((w) => {
        const normW = w.replace(/front[\s-]end/g, "frontend")
        return normTarget.includes(normW)
      })
    })
  }

  // Filter by remote if remote flag requested
  if (filters.remote) {
    cards = cards.filter((c) => c.remote)
  }

  // Apply limit
  if (filters.limit !== undefined && filters.limit >= 0) {
    cards = cards.slice(0, filters.limit)
  }

  return cards
}

export function parseJobDetail(data: any, id: string): WaasJobDetail {
  const job = data?.props?.job || {}
  const comp = data?.props?.company || {}
  const applyUrl = validateApplyUrl(data?.props?.applyUrl)
  const loc = job.location || comp.location || null
  const isRemote = typeof loc === "string" && /\bremote\b/i.test(loc)

  return stripInvisible({
    id,
    title: job.title || "",
    company: comp.name || "",
    batch: comp.batch || null,
    location: loc,
    remote: isRemote,
    category: null,
    salary: job.salaryRange || null,
    equity: job.equityRange || null,
    jobType: job.jobType || null,
    minExperience: job.minExperience || null,
    sponsorsVisa: job.sponsorsVisa || null,
    skills: Array.isArray(job.skills) ? job.skills : [],
    date: null,
    url: `${BASE_URL}/jobs/${id}`,
    description: htmlToPlain(job.descriptionHtml),
    companyDescription: htmlToPlain(comp.description),
    techDescription: htmlToPlain(comp.techDescriptionHtml),
    hiringDescription: htmlToPlain(comp.hiringDescriptionHtml),
    companyUrl: comp.url || null,
    teamSize: typeof comp.teamSize === "number" ? comp.teamSize : null,
    applyUrl,
  })
}
