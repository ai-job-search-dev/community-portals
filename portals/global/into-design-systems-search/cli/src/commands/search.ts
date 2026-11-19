import { callTool, daysAgoIso, normalizeSearchJob, type PortalResult } from "../helpers.js"

export interface SearchOpts {
  query?: string
  country?: string
  workType?: "remote" | "hybrid" | "onsite"
  jobage?: number
  before?: string
  limit: number
  format: "json" | "table" | "plain"
}

interface SearchResponse {
  total?: number
  returned?: number
  truncated?: boolean
  truncatedNote?: string
  jobs?: unknown[]
}

const NO_DETAIL = "(no detail page)"

// `id` is the slug a reader copies straight into `detail`, so its column is
// sized to the widest value rather than cut to a fixed width. The rest are
// prose and may be elided.
const COLUMNS = [
  { header: "ID", width: 32, clip: false, value: (row: PortalResult) => row.id ?? NO_DETAIL },
  { header: "TITLE", width: 42, clip: true, value: (row: PortalResult) => row.title },
  { header: "COMPANY", width: 24, clip: true, value: (row: PortalResult) => row.company },
  { header: "LOCATION", width: 28, clip: true, value: (row: PortalResult) => row.location },
  { header: "DATE", width: 10, clip: true, value: (row: PortalResult) => row.date },
]

export function table(rows: PortalResult[]): string {
  if (!rows.length) return "No results."
  const widths = COLUMNS.map((column) =>
    column.clip
      ? column.width
      : Math.max(column.header.length, ...rows.map((row) => (column.value(row) ?? "—").length)),
  )
  const cell = (text: string, index: number) =>
    (COLUMNS[index].clip ? text.slice(0, widths[index]) : text).padEnd(widths[index])
  const header = COLUMNS.map((column, index) => cell(column.header, index)).join(" ")
  const body = rows.map((row) => COLUMNS.map((column, index) => cell(column.value(row) ?? "—", index)).join(" "))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

/**
 * Human-facing notice for `meta.truncated`. JSON output passes the server's own
 * `truncatedNote` through untouched; this text is written locally and is not
 * that string, because a truncated search that prints like a complete one is
 * the worst of the board's quirks to hide.
 */
export function truncationNote(response: SearchResponse): string {
  if (!response.truncated) return ""
  const total = response.total === undefined ? "More roles" : `${response.total} roles`
  return `\n${total} match. Narrow with --jobage and --before to walk the rest.`
}

function plain(rows: PortalResult[]): string {
  if (!rows.length) return "No results."
  return rows
    .map((row) => {
      const meta = [row.company ?? "—", row.location ?? "—", row.date ?? "—"].join(" · ")
      const slug = row.id ? `slug: ${row.id}` : "no detail page — search fields only"
      return `${row.title}\n  ${meta}\n  ${slug}\n  ${row.url}`
    })
    .join("\n\n")
}

function toolArgs(opts: SearchOpts): Record<string, unknown> {
  const args: Record<string, unknown> = { limit: opts.limit }
  if (opts.query) args.query = opts.query
  if (opts.country) args.country = opts.country
  // `workType` already selects only postings that state the arrangement, so
  // passing `remote: true` alongside it changes nothing.
  if (opts.workType) args.workType = opts.workType
  if (opts.jobage !== undefined) args.postedAfter = daysAgoIso(opts.jobage)
  if (opts.before) args.postedBefore = opts.before
  return args
}

export async function runSearch(opts: SearchOpts): Promise<void> {
  const response = await callTool<SearchResponse>("search_jobs", toolArgs(opts))

  // Keep every listing the board returns, including the ones held without
  // posting text: those have no slug, so `detail` cannot read them, but their
  // search fields are complete enough to rank and track. Drop only records
  // that are unusable — no title or nowhere to apply.
  const results = (response.jobs ?? []).map(normalizeSearchJob).filter((job) => job.title && job.url)
  const withoutDetail = results.filter((job) => !job.id).length

  if (opts.format === "table") {
    process.stdout.write(table(results) + truncationNote(response) + "\n")
    return
  }
  if (opts.format === "plain") {
    process.stdout.write(plain(results) + truncationNote(response) + "\n")
    return
  }

  const output = {
    meta: {
      count: results.length,
      // The board has no offset paging; narrow with --jobage/--before instead.
      page: 1,
      total: response.total ?? results.length,
      truncated: Boolean(response.truncated),
      truncatedNote: response.truncatedNote ?? null,
      withoutDetail,
    },
    results,
  }
  process.stdout.write(JSON.stringify(output, null, 2) + "\n")
}
