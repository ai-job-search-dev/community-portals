import {
  fetchBoard,
  fetchOrgName,
  matchesLocation,
  matchesWorkplace,
  stripInvisible,
  titleMatches,
  toCard,
  withinDays,
  writeError,
  type JobCard,
} from "../helpers.js"

export const PAGE_SIZE = 20

/** Polite gap between boards when several are searched (ms), plus jitter. */
const BOARD_GAP_MS = 500

export interface SearchOpts {
  boards: string[]
  query?: string
  location?: string
  remote?: string
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "TITLE".padEnd(46) + " " + "COMPANY".padEnd(14) + " " + "LOCATION".padEnd(28) + " " + "POSTED".padEnd(10) + " ID"
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 46).padEnd(46)
    const company = (c.company || "—").slice(0, 14).padEnd(14)
    const loc = (c.location || "—").slice(0, 28).padEnd(28)
    const date = (c.date || "—").slice(0, 10).padEnd(10)
    return `${title} ${company} ${loc} ${date} ${c.id}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const all: JobCard[] = []
    const boardStats: { board: string; company: string | null; total: number | null; error: string | null }[] = []

    for (let i = 0; i < opts.boards.length; i++) {
      const board = opts.boards[i]
      if (i > 0) await new Promise((r) => setTimeout(r, BOARD_GAP_MS + Math.floor(Math.random() * 400)))
      const data = await fetchBoard(board)
      if (!data) {
        boardStats.push({ board, company: null, total: null, error: "BOARD_NOT_FOUND" })
        continue
      }
      const jobs = (data.jobs ?? []).filter((j) => j.isListed !== false)
      const company = jobs.length ? await fetchOrgName(board) : null
      boardStats.push({ board, company: company ?? board, total: jobs.length, error: null })
      for (const j of jobs) all.push(toCard(j, board, company))
    }

    // A single-board search for a board that does not exist is an error, as in
    // greenhouse-search; in a multi-board search it is reported in meta.boards.
    if (opts.boards.length === 1 && boardStats[0].error) {
      writeError(`No Ashby job board named "${opts.boards[0]}" (HTTP 404)`, "BOARD_NOT_FOUND")
      return 1
    }

    const matched = all
      .filter(
        (c) =>
          titleMatches(c.title, opts.query) &&
          matchesLocation(c, opts.location) &&
          matchesWorkplace(c, opts.remote) &&
          withinDays(c.date, opts.jobage),
      )
      .sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0))

    const start = (opts.page - 1) * PAGE_SIZE
    let cards = stripInvisible(matched.slice(start, start + PAGE_SIZE))
    if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (cards.length === 0
          ? "No results."
          : cards
              .map(
                (c) =>
                  `${c.title}\n  ${c.company || "—"} · ${c.location || "—"}${c.workplace ? ` · ${c.workplace}` : ""} · ${(c.date || "—").slice(0, 10)}` +
                  `${c.salary ? `\n  ${c.salary}` : ""}\n  id: ${c.id} (board ${c.board})\n  ${c.url}`,
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
              matched: matched.length,
              boards: stripInvisible(boardStats),
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
