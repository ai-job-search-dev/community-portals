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
    const failures: { board: string; message: string }[] = []

    for (let i = 0; i < opts.boards.length; i++) {
      const board = opts.boards[i]
      if (i > 0) await new Promise((r) => setTimeout(r, BOARD_GAP_MS + Math.floor(Math.random() * 400)))
      let data: Awaited<ReturnType<typeof fetchBoard>>
      try {
        data = await fetchBoard(board)
      } catch (e) {
        // One failing board must not discard the others; a single-board search still fails.
        if (opts.boards.length === 1) throw e
        boardStats.push({ board, company: null, total: null, error: "FETCH_FAILED" })
        failures.push({ board, message: e instanceof Error ? e.message : String(e) })
        continue
      }
      if (!data) {
        boardStats.push({ board, company: null, total: null, error: "BOARD_NOT_FOUND" })
        failures.push({ board, message: "no Ashby job board with this slug (HTTP 404)" })
        continue
      }
      const jobs = (data.jobs ?? []).filter((j) => j.isListed !== false)
      const company = jobs.length ? await fetchOrgName(board) : null
      boardStats.push({ board, company: company ?? board, total: jobs.length, error: null })
      // Sanitize before matching, so an invisible character cannot hide a visible match.
      for (const j of jobs) all.push(stripInvisible(toCard(j, board, company)))
    }

    // Every board failing is an error, as a single unknown board is in greenhouse-search;
    // otherwise failed boards are reported in meta.boards (JSON) or as stderr warnings.
    if (boardStats.every((b) => b.error)) {
      const allMissing = boardStats.every((b) => b.error === "BOARD_NOT_FOUND")
      const msg = opts.boards.length === 1
        ? `No Ashby job board named "${opts.boards[0]}" (HTTP 404)`
        : `No board could be read: ${failures.map((f) => `${f.board} (${f.message})`).join("; ")}`
      writeError(msg, allMissing ? "BOARD_NOT_FOUND" : "SEARCH_FAILED")
      return 1
    }
    if (opts.format !== "json") {
      for (const f of failures) {
        const code = boardStats.find((b) => b.board === f.board)?.error ?? "FETCH_FAILED"
        process.stderr.write(JSON.stringify({ warning: `board "${f.board}" skipped: ${f.message}`, code }) + "\n")
      }
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
    let cards = matched.slice(start, start + PAGE_SIZE)
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
