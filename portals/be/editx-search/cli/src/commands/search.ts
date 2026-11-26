import {
  MAX_PAGE_SIZE,
  SEARCH_PATH,
  apiGet,
  isJob,
  stripInvisible,
  toResult,
  writeError,
  writeWarning,
  type EditxSearchResponse,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  jobage?: number
  page: number // 1-indexed
  limit: number
  format: "json" | "table" | "plain"
}

/**
 * The API query. A page is always a fixed block of 50 (`count=50`, the API's
 * maximum), so `--page n` means the same results whatever `--limit` or
 * `--jobage` are; both are applied client-side to that block. `page` is 0-based
 * on the wire.
 */
export function buildQuery(opts: SearchOpts): URLSearchParams {
  const p = new URLSearchParams()
  p.set("keyword", opts.query)
  if (opts.location) p.set("location", opts.location)
  if (opts.page > 1) p.set("page", String(opts.page - 1))
  p.set("count", String(MAX_PAGE_SIZE))
  return p
}

/**
 * Whether a YYYY-MM-DD date falls in the last `days` days, counting today as
 * day 1 (`--jobage 1` = today, `--jobage 7` = today and the six days before).
 * Dates after today are kept out.
 */
export function withinDays(date: string | null, days: number, today = new Date()): boolean {
  if (!date) return false
  const posted = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(posted)) return false
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const age = startOfToday - posted
  return age >= 0 && age < days * 86_400_000
}

interface Column {
  header: string
  width: number
  cell: (r: JobResult) => string
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const columns: Column[] = [
    { header: "ID", width: Math.max(2, ...rows.map((r) => r.id.length)), cell: (r) => r.id },
    { header: "TITLE", width: 40, cell: (r) => r.title },
    { header: "COMPANY", width: 22, cell: (r) => r.company ?? "-" },
    { header: "LOCATION", width: 24, cell: (r) => r.location ?? "-" },
    { header: "DATE", width: 10, cell: (r) => r.date ?? "-" },
  ]
  const row = (cells: string[]) => cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")
  const header = row(columns.map((c) => c.header))
  return [header, "-".repeat(header.length), ...rows.map((r) => row(columns.map((c) => c.cell(r))))].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) =>
      [
        r.title,
        `  ${r.company ?? "-"} | ${r.location ?? "-"} | ${r.date ?? "-"}`,
        `  ${[r.remote, r.contract].filter(Boolean).join(" | ") || "-"}`,
        `  id: ${r.id}`,
        `  ${r.url}`,
      ].join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const body = await apiGet<EditxSearchResponse>(`${SEARCH_PATH}?${buildQuery(opts).toString()}`)
    if (!body) {
      writeError(`${SEARCH_PATH} not found on the editx API; the endpoint may have moved`, "SEARCH_FAILED")
      return 1
    }
    // Past the last page the API answers `jobs: null` with `total: 0`; that is an
    // empty page, not a search with no matches, so total is reported as unknown.
    // Any other shape means the undocumented API changed: fail loudly rather
    // than report it as zero results.
    if (typeof body !== "object" || (body.jobs !== null && !Array.isArray(body.jobs))) {
      writeError("unexpected response shape from the editx API (no jobs list); the endpoint may have changed", "SEARCH_FAILED")
      return 1
    }
    const jobs = Array.isArray(body.jobs) ? body.jobs : []
    const total = body.jobs === null && opts.page > 1 ? null : (typeof body.total === "number" ? body.total : null)

    // One malformed entry (null, or no numeric id) is skipped, not fatal. If
    // every entry is malformed, the shape changed: fail rather than report
    // zero results next to the API's non-zero total.
    const valid = jobs.filter(isJob)
    if (jobs.length > 0 && valid.length === 0) {
      writeError("no usable jobs in the editx API response (entries lack a numeric id); the response shape may have changed", "SEARCH_FAILED")
      return 1
    }
    let rows = stripInvisible(valid.map(toResult))
    if (opts.jobage !== undefined) rows = rows.filter((r) => withinDays(r.date, opts.jobage as number))
    rows = rows.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(JSON.stringify({ meta: { count: rows.length, page: opts.page, total }, results: rows }, null, 2) + "\n")
    }
    // After stdout, so a diagnostic never interleaves with the JSON; the request succeeded, so exit 0.
    if (opts.limit > MAX_PAGE_SIZE) {
      writeWarning(`--limit ${opts.limit} is above the ${MAX_PAGE_SIZE} jobs on one page; use --page for more`, "LIMIT_CAPPED")
    }
    if (opts.jobage !== undefined) {
      writeWarning(
        `--jobage filtered this page of up to ${MAX_PAGE_SIZE} relevance-ordered results client-side (Editx has no date filter); recent postings can sit on later pages`,
        "JOBAGE_CLIENT_SIDE",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
