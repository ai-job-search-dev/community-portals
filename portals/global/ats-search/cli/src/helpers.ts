// Helpers for querying direct company ATS boards (Greenhouse, Lever, Ashby).
// Keyless, public JSON APIs with exponential backoff and normalized output.

import { join, resolve } from "path"
import { readFileSync, existsSync } from "fs"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; ats-search-cli/1.0)"

export type ATSProvider = "greenhouse" | "lever" | "ashby"

export interface WatchlistEntry {
  company: string
  provider: ATSProvider
  slug: string
  keywords?: string[]
}

export interface NormalizedJob {
  id: string
  site: string
  company: string
  title: string
  location: string | null
  type: string | null
  salary: string | null
  url: string
  apply_url: string
  date: string | null
  description: string | null
  provider: ATSProvider
}

export function loadWatchlist(customPath?: string): WatchlistEntry[] {
  // If explicitly specified, treat as authoritative and fail on error without falling back
  if (customPath !== undefined) {
    const abs = resolve(customPath)
    if (!existsSync(abs)) {
      throw new Error(`Watchlist file not found: ${customPath}`)
    }
    const content = readFileSync(abs, "utf-8")
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (e) {
      throw new Error(
        `Watchlist file ${customPath} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`Watchlist file ${customPath} must contain a JSON array of entries`)
    }
    return parsed as WatchlistEntry[]
  }

  // The watchlist ships inside the skill folder, so an installed portal works
  // without a repo checkout: <skill>/watchlist.json is two levels above cli/src.
  const candidatePaths = [
    join(import.meta.dir, "..", "..", "watchlist.json"),
    join(process.cwd(), "tools/ats_watchlist.json"),
    join(process.cwd(), "../../tools/ats_watchlist.json"),
    join(process.cwd(), "../../../../tools/ats_watchlist.json"),
  ]

  for (const p of candidatePaths) {
    const abs = resolve(p)
    if (existsSync(abs)) {
      try {
        const content = readFileSync(abs, "utf-8")
        return JSON.parse(content) as WatchlistEntry[]
      } catch {
        continue
      }
    }
  }

  throw new Error("Could not find watchlist.json next to the skill. Specify --watchlist <path>")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

const ATS_HOST_GROUPS: string[][] = [
  ["boards-api.greenhouse.io", "boards.greenhouse.io"],
  ["api.lever.co", "jobs.lever.co"],
  ["api.ashbyhq.com", "jobs.ashbyhq.com"],
]

function isAllowedRedirect(fromUrl: string, toUrl: string): boolean {
  try {
    const from = new URL(fromUrl)
    const to = new URL(toUrl)
    if (to.protocol !== "http:" && to.protocol !== "https:") return false
    // No HTTPS -> HTTP downgrade: a provider redirect must not turn the request
    // into cleartext on the way to an otherwise allowed host.
    if (from.protocol === "https:" && to.protocol === "http:") return false
    for (const group of ATS_HOST_GROUPS) {
      if (group.includes(from.hostname)) {
        return group.includes(to.hostname)
      }
    }
    return to.hostname === from.hostname
  } catch {
    return false
  }
}

export async function fetchWithBackoff(initialUrl: string): Promise<any> {
  const maxRetries = 6
  let delay = 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let currentUrl = initialUrl
    let redirectCount = 0
    const maxRedirects = 5
    let response: Response

    while (true) {
      try {
        response = await fetch(currentUrl, {
          headers: { "User-Agent": UA, Accept: "application/json" },
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        })
      } catch (e) {
        throw new Error(`Connection error to ${currentUrl}: ${e instanceof Error ? e.message : String(e)}`)
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount >= maxRedirects) {
          throw new Error(`Too many redirects (max ${maxRedirects}) from ${initialUrl}`)
        }
        const location = response.headers.get("location")
        if (!location) {
          throw new Error(`Redirect response from ${currentUrl} missing Location header`)
        }
        const nextUrl = new URL(location, currentUrl).href
        if (!isAllowedRedirect(currentUrl, nextUrl)) {
          const nextHost = new URL(nextUrl).hostname
          throw new Error(`Redirect to unauthorized host "${nextHost}" from ${currentUrl}`)
        }
        currentUrl = nextUrl
        redirectCount++
        continue
      }
      break
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`ATS request failed after retries: ${response.status} ${response.statusText}`)
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`ATS request failed: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }
  throw new Error("Request failed after max retries")
}

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
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const initialDecoded = decodeHtmlEntities(html)
  const withBreaks = initialDecoded
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = decodeHtmlEntities(withBreaks.replace(/<\/?[a-zA-Z][^>]*>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

export function sanitizeApplyUrl(applyUrl: string | null | undefined, postingUrl: string): string {
  try {
    const base = new URL(postingUrl)
    const resolved = applyUrl ? new URL(applyUrl, base) : base
    if (resolved.protocol === "http:" || resolved.protocol === "https:") {
      return resolved.href
    }
  } catch {}
  try {
    const base = new URL(postingUrl)
    if (base.protocol === "http:" || base.protocol === "https:") {
      return base.href
    }
  } catch {}
  return ""
}

export function normalizeGreenhouseJob(j: any, slug: string, companyName?: string): NormalizedJob {
  const jobId = String(j.id)
  const offices = Array.isArray(j.offices)
    ? j.offices.map((o: any) => o.location || o.name).filter(Boolean)
    : []
  const location = j.location?.name || offices.join(", ") || "Remote"
  const date = j.first_published
    ? j.first_published.slice(0, 10)
    : j.updated_at
      ? j.updated_at.slice(0, 10)
      : null
  const company = companyName || j.company_name || slug

  return {
    id: `greenhouse:${slug}:${jobId}`,
    site: `GREENHOUSE:${company}`,
    company,
    title: decodeHtmlEntities(j.title || "(untitled)"),
    location,
    type: j.employment_type || null,
    salary: null,
    url: j.absolute_url,
    apply_url: sanitizeApplyUrl(j.absolute_url, j.absolute_url),
    date,
    description: cleanHtml(j.content),
    provider: "greenhouse",
  }
}

export function normalizeLeverJob(j: any, slug: string, companyName?: string): NormalizedJob {
  const jobId = String(j.id)
  const loc = j.categories?.location || j.workplaceType || "Remote"
  const date = j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : null
  const desc = j.descriptionPlain || cleanHtml(j.description) || j.descriptionBodyPlain || null
  const company = companyName || slug

  return {
    id: `lever:${slug}:${jobId}`,
    site: `LEVER:${company}`,
    company,
    title: decodeHtmlEntities(j.text || "(untitled)"),
    location: loc,
    type: j.categories?.commitment || j.workplaceType || null,
    salary: null,
    url: j.hostedUrl,
    apply_url: sanitizeApplyUrl(j.applyUrl || j.hostedUrl, j.hostedUrl),
    date,
    description: desc,
    provider: "lever",
  }
}

export function normalizeAshbyJob(j: any, slug: string, companyName?: string): NormalizedJob {
  const jobId = String(j.id)
  const location = j.location || (j.isRemote ? "Remote" : null) || j.workplaceType || "Remote"
  const date = j.publishedAt ? j.publishedAt.slice(0, 10) : null
  const salary = j.compensation?.compensationTierSummary || j.compensation?.summary || null
  const desc = j.descriptionPlain || cleanHtml(j.descriptionHtml) || null
  const company = companyName || slug

  return {
    id: `ashby:${slug}:${jobId}`,
    site: `ASHBY:${company}`,
    company,
    title: decodeHtmlEntities(j.title || "(untitled)"),
    location,
    type: j.employmentType || j.workplaceType || null,
    salary,
    url: j.jobUrl,
    apply_url: sanitizeApplyUrl(j.applyUrl || j.jobUrl, j.jobUrl),
    date,
    description: desc,
    provider: "ashby",
  }
}

export async function fetchGreenhouseJobs(entry: WatchlistEntry): Promise<NormalizedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${entry.slug}/jobs?content=true`
  const data = await fetchWithBackoff(url)
  if (!data || !data.jobs) return []
  return data.jobs.map((j: any) => normalizeGreenhouseJob(j, entry.slug, entry.company))
}

export async function fetchLeverJobs(entry: WatchlistEntry): Promise<NormalizedJob[]> {
  const limit = 100
  const maxPostings = 5000
  let skip = 0
  const allPostings: any[] = []

  while (allPostings.length < maxPostings) {
    const url = `https://api.lever.co/v0/postings/${entry.slug}?skip=${skip}&limit=${limit}`
    const data = await fetchWithBackoff(url)
    if (!Array.isArray(data) || data.length === 0) break
    allPostings.push(...data)
    if (data.length < limit) break
    skip += data.length
  }

  return allPostings.map((j: any) => normalizeLeverJob(j, entry.slug, entry.company))
}

export async function fetchAshbyJobs(entry: WatchlistEntry): Promise<NormalizedJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${entry.slug}?includeCompensation=true`
  const data = await fetchWithBackoff(url)
  if (!data || !data.jobs) return []
  return data.jobs.map((j: any) => normalizeAshbyJob(j, entry.slug, entry.company))
}

export async function fetchBoardJobs(entry: WatchlistEntry): Promise<NormalizedJob[]> {
  switch (entry.provider) {
    case "greenhouse":
      return fetchGreenhouseJobs(entry)
    case "lever":
      return fetchLeverJobs(entry)
    case "ashby":
      return fetchAshbyJobs(entry)
    default:
      return []
  }
}
