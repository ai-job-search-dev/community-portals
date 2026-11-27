import {
  fetchBoardJobs,
  loadWatchlist,
  writeError,
  type NormalizedJob,
  type WatchlistEntry,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  company?: string
  provider?: string
  watchlist?: string
  jobage?: number
  limit: number
  format: "json" | "table" | "plain"
}

const DEFAULT_KEYWORDS = [
  "engineer",
  "frontend",
  "front-end",
  "react",
  "typescript",
  "ai",
  "full stack",
  "fullstack",
  "full-stack",
  "next.js",
  "software",
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function matchScore(job: NormalizedJob, query?: string, entryKeywords?: string[]): number {
  const title = job.title || ""
  const desc = job.description || ""

  if (query !== undefined) {
    const words = query.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return 0

    const regexes = words.map((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`, "i"))
    if (regexes.every((re) => re.test(title))) return 10
    if (regexes.every((re) => re.test(title) || re.test(desc))) return 2
    return 0
  }

  // Default matching: match engineer/frontend/react/typescript/ai/full stack across title or description
  const keywords = entryKeywords && entryKeywords.length > 0 ? entryKeywords : DEFAULT_KEYWORDS
  let score = 0
  for (const kw of keywords) {
    const regex = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i")
    if (regex.test(title)) {
      score += 5
    } else if (regex.test(desc)) {
      score += 1
    }
  }
  return score
}

function matchesJobage(job: NormalizedJob, days: number): boolean {
  if (!job.date || days <= 0 || days >= 9999) return true
  const time = new Date(job.date).getTime()
  if (isNaN(time)) return true
  const ageMs = Date.now() - time
  return ageMs <= days * 24 * 60 * 60 * 1000
}

function shortDate(date: string | null): string {
  return date ? date.slice(0, 10) : "—"
}

interface Column {
  header: string
  width: number
  cell: (r: NormalizedJob) => string
}

function renderTable(rows: NormalizedJob[]): string {
  if (rows.length === 0) return "No results."
  const columns: Column[] = [
    { header: "SITE", width: 20, cell: (r) => r.site },
    { header: "TITLE", width: 36, cell: (r) => r.title },
    { header: "COMPANY", width: 16, cell: (r) => r.company },
    { header: "LOCATION", width: 22, cell: (r) => r.location ?? "—" },
    { header: "DATE", width: 10, cell: (r) => shortDate(r.date) },
  ]
  const row = (cells: string[]) =>
    cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")

  const header = row(columns.map((c) => c.header))
  const body = rows.map((r) => row(columns.map((c) => c.cell(r))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: NormalizedJob[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) =>
      [
        r.title,
        `  ${r.site} · ${r.location ?? "—"} · ${shortDate(r.date)}`,
        r.salary ? `  Salary: ${r.salary}` : "",
        `  id: ${r.id}`,
        `  apply: ${r.apply_url}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n")
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let index = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i])
    }
  })

  await Promise.all(workers)
  return results
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    let watchlist = loadWatchlist(opts.watchlist)

    if (opts.provider) {
      const p = opts.provider.toLowerCase()
      watchlist = watchlist.filter((w) => w.provider === p)
    }

    if (opts.company) {
      const c = opts.company.toLowerCase()
      watchlist = watchlist.filter((w) => w.company.toLowerCase().includes(c) || w.slug.toLowerCase().includes(c))
    }

    if (watchlist.length === 0) {
      writeError("No companies matched the specified filters in the watchlist", "EMPTY_WATCHLIST")
      return 1
    }

    // Fetch boards in parallel with bounded concurrency
    let failedBoards = 0
    const boardResults = await mapConcurrent(watchlist, 6, async (entry) => {
      try {
        const jobs = await fetchBoardJobs(entry)
        return { entry, jobs }
      } catch (e) {
        failedBoards++
        writeError(
          `Failed to fetch ${entry.provider} board for ${entry.company}: ${e instanceof Error ? e.message : String(e)}`,
          "BOARD_FAILED",
        )
        return { entry, jobs: [] }
      }
    })

    if (failedBoards === watchlist.length && watchlist.length > 0) {
      return 1
    }

    const scoredJobs: Array<{ job: NormalizedJob; score: number }> = []
    const seenUrls = new Set<string>()

    for (const { entry, jobs } of boardResults) {
      for (const job of jobs) {
        if (seenUrls.has(job.url)) continue

        const score = matchScore(job, opts.query, entry.keywords)
        if (score <= 0) continue

        if (opts.jobage !== undefined && !matchesJobage(job, opts.jobage)) continue

        seenUrls.add(job.url)
        scoredJobs.push({ job, score })
      }
    }

    // Sort by relevance score descending, then date descending
    scoredJobs.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.job.date && b.job.date) return b.job.date.localeCompare(a.job.date)
      return 0
    })

    const results = scoredJobs.slice(0, opts.limit).map((s) => ({
      ...s.job,
      description: s.job.description ? s.job.description.slice(0, 1000) : null,
    }))

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
              total: scoredJobs.length,
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
