import type { Board } from "../board.js"
import { postingTail } from "../board.js"
import {
  HttpError,
  jobageCutoff,
  parsePostedOn,
  requestJson,
  stripInvisible,
  writeError,
} from "../helpers.js"

export const PAGE_SIZE = 20

// Some Workday tenants clamp a query at 2,000 postings: `total` reports 2000
// and an offset of 2000 returns the same rows as offset 0. Paging past it
// would print duplicates with exit 0, so the CLI refuses that page instead.
export const OFFSET_CEILING = 2000

export interface SearchOpts {
  board: Board
  query?: string
  page: number
  jobage?: number
  limit?: number
  format: "json" | "table" | "plain"
}

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  description: null
}

interface WorkdayPosting {
  title?: unknown
  externalPath?: unknown
  locationsText?: unknown
  postedOn?: unknown
  remoteType?: unknown
}

export interface WorkdaySearchResponse {
  total?: unknown
  jobPostings?: unknown
}

/** Location fallback: the place slug Workday puts in /job/<place>/... */
function locationFromPath(externalPath: string): string | null {
  const m = /\/job\/([^/]+)\//.exec(externalPath)
  if (!m) return null
  try {
    return decodeURIComponent(m[1]).replace(/-/g, " ") || null
  } catch {
    return null
  }
}

/**
 * Keep the list endpoint's "Fully Remote" on the location. A count placeholder
 * such as "2 Locations" is left as-is: resolving it needs the detail endpoint,
 * which reports the real places.
 */
function withRemote(location: string | null, remoteType: unknown): string | null {
  if (typeof remoteType !== "string" || remoteType.trim().toLowerCase() !== "fully remote") {
    return location
  }
  if (!location) return "Remote"
  return /remote/i.test(location) ? location : `${location} · Remote`
}

/** Map the CXS list payload to the portal contract's result shape. */
export function parseSearch(body: WorkdaySearchResponse, board: Board, now = new Date()): {
  total: number
  results: JobResult[]
} {
  const postings = Array.isArray(body.jobPostings) ? (body.jobPostings as WorkdayPosting[]) : []
  const results: JobResult[] = []

  for (const posting of postings) {
    if (!posting || typeof posting !== "object") continue
    const externalPath = typeof posting.externalPath === "string" ? posting.externalPath : ""
    // Sanitize before the emptiness check: a title made only of zero-width
    // characters would otherwise ship as a blank result.
    const title =
      typeof posting.title === "string" ? stripInvisible(posting.title).trim() : ""
    if (!title || !externalPath.startsWith("/job/")) continue

    const url = board.jobBase + externalPath
    const listed =
      typeof posting.locationsText === "string" && posting.locationsText.trim()
        ? posting.locationsText.trim()
        : locationFromPath(externalPath)

    results.push({
      id: url,
      title,
      company: board.tenant,
      location: withRemote(listed, posting.remoteType),
      date: parsePostedOn(posting.postedOn, now),
      url,
      description: null,
    })
  }

  const total = typeof body.total === "number" && body.total >= 0 ? body.total : results.length

  // A board can report a total lower than the page it just returned (0 on deep
  // pages, seen on NVIDIA 99-100). Metadata must not undercount the rows.
  return stripInvisible({ total: Math.max(total, results.length), results })
}

/** Apply `--jobage` at day granularity; undated postings cannot prove they are fresh, so they are dropped. */
export function filterByJobage(results: JobResult[], days: number | undefined, now = new Date()): JobResult[] {
  if (days === undefined) return results
  const cutoff = jobageCutoff(days, now)
  return results.filter((result) => result.date !== null && result.date >= cutoff)
}

function shortDate(date: string | null): string {
  return date ?? "—"
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  interface Column {
    header: string
    width: number
    cell: (r: JobResult) => string
  }
  const columns: Column[] = [
    { header: "TITLE", width: 40, cell: (r) => r.title },
    { header: "COMPANY", width: 18, cell: (r) => r.company ?? "—" },
    { header: "LOCATION", width: 24, cell: (r) => r.location ?? "—" },
    { header: "DATE", width: 10, cell: (r) => shortDate(r.date) },
    { header: "REQ", width: 22, cell: (r) => postingTail(r.url) },
  ]
  const row = (cells: string[]) =>
    cells.map((cell, i) => cell.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")
  const header = row(columns.map((column) => column.header))
  const body = rows.map((r) => row(columns.map((column) => column.cell(r))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) =>
      [
        r.title,
        `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${shortDate(r.date)}`,
        `  url: ${r.url}`,
      ].join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const offset = (opts.page - 1) * PAGE_SIZE
  if (offset >= OFFSET_CEILING) {
    writeError(
      `--page ${opts.page} asks for offset ${offset}, past Workday's ${OFFSET_CEILING}-posting paging ceiling; narrow --query instead of paging deeper`,
      "PAGE_LIMIT",
    )
    return 1
  }

  const body = {
    appliedFacets: {},
    limit: PAGE_SIZE,
    offset,
    searchText: opts.query ?? "",
  }

  let payload: WorkdaySearchResponse
  try {
    payload = await requestJson<WorkdaySearchResponse>(opts.board.api, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (compatible; workday-search/1.0; +https://github.com/ai-job-search-dev/community-portals)",
        origin: opts.board.origin,
        referer: `${opts.board.jobBase}/`,
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const hint =
      e instanceof HttpError && e.status === 404
        ? ` - the board URL or site may be wrong; check ${opts.board.jobBase} loads in a browser`
        : e instanceof HttpError && (e.status === 401 || e.status === 403 || e.status === 422)
          ? ` - the board may be retired or restricted; check ${opts.board.jobBase} loads in a browser`
          : ""
    writeError(message + hint, "SEARCH_FAILED")
    return 1
  }

  const parsed = parseSearch(payload, opts.board)
  let results = filterByJobage(parsed.results, opts.jobage)
  if (opts.limit !== undefined) results = results.slice(0, opts.limit)

  if (opts.format === "json") {
    process.stdout.write(
      JSON.stringify(
        {
          meta: { total: parsed.total, page: opts.page, perPage: PAGE_SIZE },
          results,
        },
        null,
        2,
      ) + "\n",
    )
  } else if (opts.format === "table") {
    process.stdout.write(renderTable(results) + "\n")
  } else {
    process.stdout.write(renderPlain(results) + "\n")
  }
  return 0
}
