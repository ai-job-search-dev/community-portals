import {
  apiGet,
  toResult,
  writeError,
  type HimalayasJob,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  jobage?: number
  page: number
  limit: number
  category?: string
  location?: string
  format: "json" | "table" | "plain"
}

const TECH_KEYWORDS = [
  "developer",
  "engineer",
  "software",
  "frontend",
  "front-end",
  "backend",
  "back-end",
  "fullstack",
  "full-stack",
  "full stack",
  "web",
  "react",
  "typescript",
  "javascript",
  "python",
  "ai",
  "ml",
  "machine learning",
  "data",
  "devops",
  "cloud",
  "product",
  "designer",
  "ui",
  "ux",
  "qa",
]

function matchesQuery(job: HimalayasJob, query: string): boolean {
  const q = query.toLowerCase()
  const title = (job.title || "").toLowerCase()
  const excerpt = (job.excerpt || "").toLowerCase()
  const company = (job.companyName || "").toLowerCase()
  const categories = (job.categories || []).map((c) => c.toLowerCase()).join(" ")

  if (title.includes(q) || company.includes(q) || categories.includes(q) || excerpt.includes(q)) {
    return true
  }

  // Also check individual words if multi-word query
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    const hay = `${title} ${company} ${categories} ${excerpt}`
    return words.every((w) => hay.includes(w))
  }

  return false
}

function matchesCategory(job: HimalayasJob, category: string): boolean {
  const cat = category.toLowerCase().replace(/[-\s]+/g, "")
  const cats = (job.categories || []).concat(job.parentCategories || [])
  return cats.some((c) => c.toLowerCase().replace(/[-\s]+/g, "").includes(cat))
}

// Common abbreviations, expanded so -l UK cannot answer with Ukraine and -l US
// cannot answer with Australia.
// Each entry expands to every spelling the board uses for that market, so
// -l USA and -l US both match "United States", and -l GB matches "Great Britain".
const LOCATION_ALIASES: Record<string, string[]> = {
  us: ["united states", "usa", "u.s."],
  usa: ["united states", "us", "u.s."],
  uk: ["united kingdom", "great britain", "gb"],
  gb: ["united kingdom", "great britain", "uk"],
  uae: ["united arab emirates"],
  eu: ["european union", "europe"],
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Acronyms (3 chars or fewer) must match exactly, so "ui" does not hit
// "Building" and "ai" does not hit "email". Longer keywords also accept their
// plural/derivative forms: developer -> developers, engineer -> engineering,
// data -> database.
function matchesKeyword(haystack: string, keyword: string): boolean {
  if (keyword.length <= 3) return matchesWholeWord(haystack, keyword)
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}[a-z]*([^a-z0-9]|$)`).test(haystack)
}

function matchesWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`).test(haystack)
}

function matchesLocation(job: HimalayasJob, location: string): boolean {
  const loc = location.toLowerCase().trim()
  const extra = Object.hasOwn(LOCATION_ALIASES, loc) ? LOCATION_ALIASES[loc] : []
  const needles = [loc, ...extra]
  const restrictions = (job.locationRestrictions || []).map((r) => r.toLowerCase())
  if (restrictions.length === 0) return true // No restrictions means worldwide
  return restrictions.some((r) => needles.some((n) => matchesWholeWord(r, n)))
}

function matchesJobage(job: HimalayasJob, days: number): boolean {
  if (!job.pubDate || days <= 0 || days >= 9999) return true
  const ms = job.pubDate > 1e11 ? job.pubDate : job.pubDate * 1000
  const ageMs = Date.now() - ms
  const maxMs = days * 24 * 60 * 60 * 1000
  return ageMs <= maxMs
}

function isTechRole(job: HimalayasJob): boolean {
  const title = (job.title || "").toLowerCase()
  const cats = (job.categories || []).map((c) => c.toLowerCase()).join(" ")
  const parents = (job.parentCategories || []).map((c) => c.toLowerCase()).join(" ")
  const hay = `${title} ${cats} ${parents}`
  // Whole words only: a substring test lets "ui" match "Building Manager"
  // and "ai" match "email".
  return TECH_KEYWORDS.some((kw) => matchesKeyword(hay, kw))
}

function shortDate(date: string | null): string {
  return date ? date.slice(0, 10) : "—"
}

interface Column {
  header: string
  width: number
  cell: (r: JobResult) => string
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const columns: Column[] = [
    { header: "ID", width: 20, cell: (r) => r.id },
    { header: "TITLE", width: 38, cell: (r) => r.title },
    { header: "COMPANY", width: 22, cell: (r) => r.company ?? "—" },
    { header: "LOCATION", width: 22, cell: (r) => r.location ?? "—" },
    { header: "DATE", width: 10, cell: (r) => shortDate(r.date) },
  ]
  const row = (cells: string[]) =>
    cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")

  const header = row(columns.map((c) => c.header))
  const body = rows.map((r) => row(columns.map((c) => c.cell(r))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) =>
      [
        r.title,
        `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${shortDate(r.date)}`,
        r.salary ? `  Salary: ${r.salary}` : "",
        `  id: ${r.id}`,
        `  ${r.url}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const requestedLimit = opts.limit
    // `--page` counts pages of the FILTERED result set, so page 2 starts after
    // the first `limit` matches rather than after the first 20 feed rows. Paging
    // the raw feed instead made consecutive pages overlap or skip once a filter
    // removed rows. Scanning still starts at the top and is capped.
    const targetMatches = opts.page * requestedLimit
    const matched: HimalayasJob[] = []
    const seenIds = new Set<string>()
    const pageSize = 20
    let currentOffset = 0
    const maxPagesToFetch = 15

    for (let p = 0; p < maxPagesToFetch; p++) {
      const data = await apiGet({ limit: pageSize, offset: currentOffset })
      const jobs = data.jobs || []
      if (jobs.length === 0) break

      for (const job of jobs) {
        const id = (job.applicationLink || job.guid || "").split("/").pop() || String(job.pubDate || Math.random())
        if (seenIds.has(id)) continue
        seenIds.add(id)

        if (opts.query && !matchesQuery(job, opts.query)) continue
        if (!opts.query && !isTechRole(job)) continue // Default toward remote-tech roles
        if (opts.category && !matchesCategory(job, opts.category)) continue
        if (opts.location && !matchesLocation(job, opts.location)) continue
        if (opts.jobage !== undefined && !matchesJobage(job, opts.jobage)) continue

        matched.push(job)
        if (matched.length >= targetMatches) break
      }

      if (matched.length >= targetMatches) break
      if (jobs.length < pageSize) break
      currentOffset += pageSize
    }

    const pageStart = (opts.page - 1) * requestedLimit
    const results = matched.slice(pageStart, pageStart + requestedLimit).map(toResult)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(results) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: results.length,
              page: opts.page,
              // How many matches the scan actually collected before it stopped.
              // Bounded by page * limit and the 300-job cap, so it is NOT the
              // total number of matches in the feed.
              scanned_matches: matched.length,
            },
            results,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
