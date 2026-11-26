import {
  addDays, CLIError, helsinkiToday, kuntarekryGet, PAGE_MAX, PAGE_SIZE_MAX, renderJobs, stripInvisible, toResult,
  type Format, type JobResult,
} from "../helpers.js"
import { filterParams, loadFilters, resolveNames, type FilterItem } from "../filters.js"

export interface SearchOpts {
  query?: string
  location?: string
  type?: string
  employment?: string
  hours?: string
  remote?: string
  orgType?: string
  jobage?: number
  sort?: "newest" | "deadline"
  page: number
  limit: number
  format: Format
}

/** Flags that need the filter vocabulary, with the filter kinds each one may match. */
const FILTER_FLAGS: Array<[keyof SearchOpts, string, string[]]> = [
  ["location", "location", ["region", "location"]],
  ["type", "type", ["type"]],
  ["employment", "employment", ["employment"]],
  ["hours", "hours", ["hour"]],
  ["remote", "remote", ["remote"]],
  ["orgType", "org-type", ["organisationtype"]],
]

/**
 * Page N is the path segment /sivuN/ (the board's own pagination links), with
 * `limit` as the page size; the board serves at most PAGE_SIZE_MAX per page.
 */
export function searchPath(query: string | undefined, filters: Record<string, string>, page: number, limit: number, sort: "newest" | "deadline" = "newest"): string {
  const params = new URLSearchParams({ format: "json", includeTotal: "1", limit: String(limit) })
  if (query) params.set("desc", query)
  for (const [key, value] of Object.entries(filters)) params.set(key, value)
  // Newest first is the board's default order; publication_end puts the closest deadline first.
  if (sort === "deadline") params.set("sort", "publication_end")
  return `/fi/tyopaikat/${page > 1 ? `sivu${page}/` : ""}?${params}`
}

export async function resolveFilters(opts: SearchOpts, load: () => Promise<FilterItem[]> = loadFilters) {
  const wanted = FILTER_FLAGS.filter(([key]) => typeof opts[key] === "string")
  if (!wanted.length) return { params: {} as Record<string, string>, applied: [] as FilterItem[] }
  const items = await load()
  const applied = wanted.flatMap(([key, flag, kinds]) => resolveNames(opts[key] as string, kinds, items, flag))
  return { params: filterParams(applied), applied }
}

export async function search(opts: SearchOpts, deps: {
  get?: (path: string) => Promise<string | null>
  load?: () => Promise<FilterItem[]>
  today?: string
} = {}) {
  const get = deps.get ?? ((path: string) => kuntarekryGet(path, "json"))
  const { params, applied } = await resolveFilters(opts, deps.load)
  if (opts.limit > PAGE_SIZE_MAX) throw new CLIError(`--limit must be at most ${PAGE_SIZE_MAX} (the board's page size cap)`, "BAD_ARG")
  const sort = opts.sort ?? "newest"
  const body = await get(searchPath(opts.query, params, opts.page, opts.limit, sort))
  if (body === null) throw new CLIError("Kuntarekry search endpoint was not found", "BAD_RESPONSE")
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new CLIError("Kuntarekry returned invalid search JSON", "BAD_RESPONSE")
  }
  const record = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}
  if (!Array.isArray(record.jobs) || !Number.isInteger(record.total) || (record.total as number) < 0) {
    throw new CLIError("Kuntarekry search response is missing its jobs list or total", "BAD_RESPONSE")
  }
  const total = record.total as number
  const rows = record.jobs.slice(0, opts.limit)
  let malformed = 0
  const seen = new Set<string>()
  const pageJobs: JobResult[] = []
  for (const raw of rows) {
    const job = toResult(raw)
    if (!job) {
      malformed++
      continue
    }
    if (!seen.has(job.id)) {
      seen.add(job.id)
      pageJobs.push(job)
    }
  }
  if (rows.length && !pageJobs.length) throw new CLIError("Kuntarekry returned jobs but none could be parsed", "BAD_RESPONSE")

  // --jobage: in newest-first order, once a job is older than the cutoff every
  // later page is too. Sorted by deadline, later pages can still hold matches.
  const cutoff = opts.jobage ? addDays(deps.today ?? helsinkiToday(), -opts.jobage) : null
  let missingDates = 0
  let reachedCutoff = false
  const results = cutoff
    ? pageJobs.filter((job) => {
        if (!job.date) {
          missingDates++
          return false
        }
        if (job.date < cutoff) {
          if (sort === "newest") reachedCutoff = true
          return false
        }
        return true
      })
    : pageJobs
  const hasMore = opts.page * opts.limit < total && rows.length === opts.limit
  return stripInvisible({
    meta: {
      count: results.length,
      page: opts.page,
      limit: opts.limit,
      sort,
      total,
      nextPage: hasMore && !reachedCutoff && opts.page < PAGE_MAX ? opts.page + 1 : null,
      jobage: opts.jobage ?? null,
      cutoff,
      missingDates,
      malformed,
      filters: applied.map((f) => ({ kind: f.kind, title: f.title, id: f.id })),
      totalIsBeforeClientFilters: true,
    },
    results,
  })
}

export async function runSearch(opts: SearchOpts): Promise<void> {
  const output = await search(opts)
  process.stdout.write((opts.format === "json" ? JSON.stringify(output, null, 2) : renderJobs(output.results, opts.format)) + "\n")
}
