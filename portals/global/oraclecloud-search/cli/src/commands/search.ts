import type { Board } from "../board.js"
import { isSegment, postingTail } from "../board.js"
import {
  HttpError,
  assembleLocation,
  jobageCutoff,
  requestJson,
  stripInvisible,
  toIsoDate,
  writeError,
} from "../helpers.js"

export const PAGE_SIZE = 20

// The facet groups ORC's own careers page asks for; the finder grammar expects
// the parameter even when the caller filters nothing.
const FACETS_LIST =
  "LOCATIONS;WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS"

export interface SearchOpts {
  board: Board
  query?: string
  location?: string
  locationId?: string
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

interface OracleRequisition {
  Id?: unknown
  Title?: unknown
  PostedDate?: unknown
  PrimaryLocation?: unknown
  WorkplaceTypeCode?: unknown
  secondaryLocations?: unknown
  workLocation?: unknown
}

export interface OracleSearchResponse {
  items?: unknown
}

/**
 * Build the finder-style search URL. Params are repeated in both the finder
 * segment and the top level: some tenants honour only one of the two. A keyword
 * goes inside the finder; `--query` rejects `,` and `;` because those are the
 * finder grammar's own separators. `locationId` is an optional per-tenant scope
 * for boards that require one. `postingStartDate` scopes the board by posting
 * age (`--jobage`).
 */
export function buildSearchUrl(
  board: Board,
  keyword: string | undefined,
  offset: number,
  locationId?: string,
  postingStartDate?: string,
): string {
  const finder = [
    `siteNumber=${board.site}`,
    `facetsList=${FACETS_LIST}`,
    `limit=${PAGE_SIZE}`,
    "sortBy=POSTING_DATES_DESC",
    `offset=${offset}`,
    ...(locationId ? [`locationId=${locationId}`] : []),
    ...(postingStartDate ? [`postingStartDate=${postingStartDate}`] : []),
    ...(keyword ? [`keyword=${keyword}`] : []),
  ].join(",")
  const params = new URLSearchParams({
    onlyData: "true",
    expand: "requisitionList.workLocation,requisitionList.secondaryLocations",
    finder: `findReqs;${finder}`,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  })
  return `${board.api}?${params}`
}

/**
 * Map the requisitions payload to the portal contract's result shape. Reads
 * items[0].requisitionList[]; drops rows with no id or title. Returns [] for
 * null / {} / missing items.
 *
 * The public URL is rebuilt from the parsed board and the requisition Id, never
 * taken from the payload's ExternalURL: the payload is third-party data and
 * must not choose where `detail` points. An id that is not one path segment is
 * dropped, so every emitted URL is one `detail` accepts.
 */
export function parseSearch(
  body: OracleSearchResponse,
  board: Board,
): { total: number; results: JobResult[] } {
  const item = Array.isArray((body as { items?: unknown[] })?.items)
    ? ((body as { items: unknown[] }).items[0] as {
        TotalJobsCount?: unknown
        requisitionList?: unknown
      } | null)
    : null
  const list = item && Array.isArray(item.requisitionList)
    ? (item.requisitionList as OracleRequisition[])
    : []
  const results: JobResult[] = []

  for (const req of list) {
    if (!req || typeof req !== "object") continue
    // The detail resource is keyed by the requisition Id. RequisitionNumber is a
    // different identifier, so using it would emit a result detail cannot open.
    const id = req.Id != null ? `${req.Id}`.trim() : ""
    const title = typeof req.Title === "string" ? stripInvisible(req.Title).trim() : ""
    // The id becomes the last URL segment; a value with `/`, `?` or `#` would
    // produce a URL `detail` cannot parse back.
    if (!id || !title || !isSegment(id)) continue

    const url = `${board.jobBase}/job/${id}`
    results.push({
      id: url,
      title,
      company: board.tenant,
      location: assembleLocation(req),
      date: toIsoDate(req.PostedDate),
      url,
      description: null,
    })
  }

  const reported = item && typeof item.TotalJobsCount === "number" && item.TotalJobsCount >= 0
    ? item.TotalJobsCount
    : results.length
  // Metadata must not undercount the rows it just returned.
  return stripInvisible({ total: Math.max(reported, results.length), results })
}

/** Case-insensitive substring match on the posting's location string. */
export function filterByLocation(results: JobResult[], location: string | undefined): JobResult[] {
  const needle = location?.trim().toLowerCase()
  if (!needle) return results
  return results.filter((result) => (result.location ?? "").toLowerCase().includes(needle))
}

/**
 * Apply `--jobage` at day granularity. ORC's list endpoint reports a plain
 * PostedDate, so this is exact; undated postings cannot prove they are fresh,
 * so they are dropped.
 */
export function filterByJobage(results: JobResult[], days: number | undefined, now = new Date()): JobResult[] {
  if (days === undefined) return results
  const cutoff = jobageCutoff(days, now)
  return results.filter((result) => result.date !== null && result.date >= cutoff)
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
    { header: "LOCATION", width: 26, cell: (r) => r.location ?? "—" },
    { header: "DATE", width: 10, cell: (r) => r.date ?? "—" },
    { header: "REQ", width: 14, cell: (r) => postingTail(r.url) },
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
        `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${r.date ?? "—"}`,
        `  url: ${r.url}`,
      ].join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const offset = (opts.page - 1) * PAGE_SIZE
  // One clock reading for the request cutoff and the client-side filter: a
  // request crossing UTC midnight must not drop the cutoff day's postings.
  const now = new Date()
  const postingStartDate = opts.jobage !== undefined ? jobageCutoff(opts.jobage, now) : undefined
  const url = buildSearchUrl(opts.board, opts.query, offset, opts.locationId, postingStartDate)

  let payload: OracleSearchResponse
  try {
    payload = await requestJson<OracleSearchResponse>(url, {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (compatible; oraclecloud-cli/1.0; +https://github.com/ai-job-search-dev/community-portals)",
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const hint =
      e instanceof HttpError && e.status === 404
        ? ` - the host or site may be wrong; check ${opts.board.jobBase} loads in a browser`
        : e instanceof HttpError && (e.status === 401 || e.status === 403)
          ? ` - the tenant may be restricted by a WAF or retired; check ${opts.board.jobBase} loads in a browser`
          : e instanceof HttpError && e.status === 400
            ? " - the board's finder rejected this query; check the careers URL and search the site by hand"
            : ""
    writeError(message + hint, "SEARCH_FAILED")
    return 1
  }

  const parsed = parseSearch(payload, opts.board)
  let results = filterByJobage(parsed.results, opts.jobage, now)
  results = filterByLocation(results, opts.location)
  if (opts.limit !== undefined) results = results.slice(0, opts.limit)

  if (opts.format === "json") {
    process.stdout.write(
      JSON.stringify(
        {
          meta: {
            count: results.length,
            total: parsed.total,
            page: opts.page,
            perPage: PAGE_SIZE,
          },
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
