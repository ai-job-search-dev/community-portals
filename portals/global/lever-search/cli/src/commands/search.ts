import {
  fetchBoard,
  matchesLocation,
  matchesQuery,
  matchesWorkplace,
  stripInvisible,
  withinDays,
  writeError,
  type JobCard,
  type Region,
  type Workplace,
} from "../helpers.js"

export const PAGE_SIZE = 20

export interface SearchOpts {
  board: string
  region: Region
  query?: string
  location?: string
  remote?: Workplace
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header = "TITLE".padEnd(48) + " " + "LOCATION".padEnd(34) + " " + "POSTED".padEnd(10) + " ID"
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 48).padEnd(48)
    const loc = (c.location || "—").slice(0, 34).padEnd(34)
    const date = (c.date || "—").slice(0, 10).padEnd(10)
    return `${title} ${loc} ${date} ${c.id}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const jobs = await fetchBoard(opts.board, opts.region)
    if (!jobs) {
      writeError(`No Lever job board named "${opts.board}" (HTTP 404)`, "BOARD_NOT_FOUND")
      return 1
    }

    const matched = jobs
      // Sanitize before matching, so an invisible character cannot hide a visible match.
      .map(stripInvisible)
      .filter(
        (c) =>
          matchesQuery(c.title, opts.query) &&
          matchesLocation(c.location, opts.location) &&
          matchesWorkplace(c, opts.remote) &&
          withinDays(c.date, opts.jobage),
      )
      .sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0))

    const pageSize = opts.limit ?? PAGE_SIZE
    const start = (opts.page - 1) * pageSize
    const cards = matched.slice(start, start + pageSize)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (cards.length === 0
          ? "No results."
          : cards
              .map(
                (c) =>
                  `${c.title}\n  ${c.company} · ${c.location || "—"} · ${(c.date || "—").slice(0, 10)}\n  id: ${c.id} (board ${c.board})\n  ${c.url}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: cards.length,
              page: opts.page,
              board: opts.board,
              matched: matched.length,
              boardTotal: jobs.length,
            },
            results: cards,
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
