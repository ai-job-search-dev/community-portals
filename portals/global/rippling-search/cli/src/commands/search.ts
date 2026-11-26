import {
  apiGet,
  companySlug,
  matchesTerms,
  matchesWorkplace,
  MAX_PAGES,
  mergeBoardJobs,
  PAGE_SIZE,
  parseTerms,
  stripInvisible,
  toResult,
  writeError,
  type BoardJob,
  type BoardPage,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  board: string
  query?: string
  // Accepted for contract compatibility, but Rippling's listing has no posting
  // date, so it cannot be applied. runSearch warns instead of silently dropping it.
  jobage?: number
  page: number
  limit: number
  // Normalised workplace types (remote | hybrid | onsite); empty means unset.
  workplace?: string[]
  format: "json" | "table" | "plain"
}

/** The board walk's result: every row read, the board's own count when known, and whether the walk ended early. */
export interface BoardFetch {
  items: BoardJob[]
  total: number | null
  /** Some postings were not read: either the cap stopped us or the board's own count exceeds what it returned. */
  truncated: boolean
  /** The page cap, not the board, ended the walk. */
  capped: boolean
}

/**
 * Walk the board's pages and return every listing row, or null when the board
 * does not exist. The whole board is read because the API has no keyword
 * search: filtering and paging happen client-side, so `meta.total` is exact
 * only when SEARCH_TRUNCATED does not fire.
 *
 * `totalItems` is the board's own row count; it may be absent. A short page is
 * the only reliable end signal without it, so keep walking until one arrives or
 * the page cap is hit. `truncated` means some postings were not read, and
 * `capped` says the page cap, not the board, ended the walk.
 */
export async function fetchBoard(slug: string): Promise<BoardFetch | null> {
  const items: BoardJob[] = []
  let total: number | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await apiGet<BoardPage>(
      `/api/v2/board/${encodeURIComponent(slug)}/jobs?page=${page}&pageSize=${PAGE_SIZE}`,
    )
    if (body === null) return null
    if (!Array.isArray(body.items)) {
      const got = body && typeof body === "object" ? Object.keys(body).join(", ") : typeof body
      throw new Error(`Rippling API returned an unexpected response: expected items[], got [${got}]`)
    }
    items.push(...body.items)
    if (typeof body.totalItems === "number") total = body.totalItems
    // Short page = the board's end. Also stop when the source's own total is met,
    // so a growing board cannot make this loop chase its tail.
    if (body.items.length < PAGE_SIZE) {
      // The board contradicts its own count: report the gap rather than
      // letting a short page hide postings.
      return { items, total, truncated: total !== null && items.length < total, capped: false }
    }
    if (total !== null && items.length >= total) {
      return { items, total, truncated: false, capped: false }
    }
  }

  // Ran out of pages, not out of rows: the board may continue past the cap.
  return { items, total, truncated: true, capped: true }
}

/** The date portion (YYYY-MM-DD) of a timestamp, or "—" when absent. */
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
    // Sized to the longest id so it is never truncated: a cut id can't be
    // passed to `detail`.
    { header: "ID", width: Math.max(2, ...rows.map((r) => r.id.length)), cell: (r) => r.id },
    { header: "TITLE", width: 40, cell: (r) => r.title },
    { header: "DEPARTMENT", width: 20, cell: (r) => r.department ?? "—" },
    { header: "LOCATION", width: 30, cell: (r) => r.location ?? "—" },
  ]
  const row = (cells: string[]) =>
    cells.map((cell, i) => cell.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")

  const header = row(columns.map((c) => c.header))
  const body = rows.map((r) => row(columns.map((c) => c.cell(r))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const block = (r: JobResult) =>
    [
      r.title,
      `  ${r.department ?? "—"} · ${r.location ?? "—"} · ${shortDate(r.date)}`,
      `  id: ${r.id}`,
      `  ${r.url}`,
    ].join("\n")
  return rows.map(block).join("\n\n")
}

export interface Warning {
  warning: string
  code: string
}

/** The search warnings `runSearch` prints after its results, in one testable place. */
export function searchWarnings(opts: SearchOpts, board: BoardFetch): Warning[] {
  const warnings: Warning[] = []
  if (opts.jobage !== undefined) {
    warnings.push({
      warning:
        "Rippling's board API exposes no posting date, so --jobage cannot be applied; no posting-age filter is active",
      code: "JOBAGE_UNSUPPORTED",
    })
  }
  if (board.truncated) {
    const why = board.capped
      ? `this CLI fetched ${board.items.length} listing rows (its ${MAX_PAGES}-page cap)`
      : `the board reports ${board.total} listing rows but returned only ${board.items.length}`
    warnings.push({
      warning: `${why}; postings beyond that are not searched, so results may be incomplete`,
      code: "SEARCH_TRUNCATED",
    })
  }
  return warnings
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const slug = companySlug(opts.board)
  if (!slug) {
    writeError(
      `could not read a Rippling board slug from "${opts.board}" — pass a slug such as "rippling" or a https://ats.rippling.com/<slug>/jobs URL`,
      "BAD_ARG",
    )
    return 1
  }

  try {
    const board = await fetchBoard(slug)
    if (board === null) {
      writeError(
        `no Rippling job board found at https://ats.rippling.com/${slug}/jobs — check the company slug`,
        "BOARD_NOT_FOUND",
      )
      return 1
    }

    const terms = parseTerms(opts.query)
    const jobs = stripInvisible(
      mergeBoardJobs(board.items)
        .filter((job) => matchesWorkplace(job, opts.workplace ?? []))
        .filter((job) => matchesTerms(job, terms))
        .map((job) => toResult(job, slug)),
    )
    const total = jobs.length
    const start = (opts.page - 1) * opts.limit
    const rows = jobs.slice(start, start + opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: rows.length, page: opts.page, total }, results: rows }, null, 2) + "\n",
      )
    }

    // After stdout: a diagnostic must never interleave with the JSON, and the
    // exit code stays 0 because an unsupported filter is not a request failure.
    for (const item of searchWarnings(opts, board)) {
      process.stderr.write(JSON.stringify(item) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
