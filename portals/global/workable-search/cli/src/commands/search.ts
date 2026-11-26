import {
  PUBLIC_API,
  foldPostings,
  jsonFetch,
  matchesLocation,
  matchesQuery,
  matchesWorkplace,
  parseWorkplace,
  stripInvisible,
  withinDays,
  writeError,
  type ApiBoard,
  type JobCard,
  type Workplace,
} from "../helpers.js"

export const PAGE_SIZE = 20

export interface SearchOpts {
  board: string
  query?: string
  location?: string
  remote?: Workplace
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const idWidth = cards.reduce((width, c) => Math.max(width, c.id.length), 10)
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 48).padEnd(48)
    const loc = (c.location || "—").slice(0, 34).padEnd(34)
    const type = (c.employmentType || "—").slice(0, 11).padEnd(11)
    const date = (c.date || "—").slice(0, 10).padEnd(10)
    return `${c.id.padEnd(idWidth)} ${title} ${loc} ${type} ${date}`
  })
  const header = "ID".padEnd(idWidth) + " " + "TITLE".padEnd(48) + " " + "LOCATION".padEnd(34) + " " + "TYPE".padEnd(11) + " " + "POSTED".padEnd(10)
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const data = await jsonFetch<ApiBoard>(`${PUBLIC_API}/accounts/${opts.board}`)
    if (!data) {
      writeError(`No Workable job board named "${opts.board}" (HTTP 404)`, "BOARD_NOT_FOUND")
      return 1
    }

    // Sanitize before matching, so an invisible character cannot hide a visible match.
    const all = foldPostings(data, opts.board).map((c) => stripInvisible(c))
    const matched = all
      .filter(
        (c) =>
          matchesQuery(c.title, opts.query) &&
          matchesLocation(c.location, opts.location) &&
          matchesWorkplace(c.workplace, opts.remote) &&
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
              .map((c) => {
                const extras = [
                  c.department,
                  c.employmentType,
                  c.workplace,
                  c.requisitionId ? `ref ${c.requisitionId}` : null,
                ].filter(Boolean).join(" · ")
                return [
                  c.title,
                  `  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}`,
                  ...(extras ? [`  ${extras}`] : []),
                  `  id: ${c.id}`,
                  `  ${c.url}`,
                ].join("\n")
              })
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
              boardTotal: all.length,
            },
            results: cards,
          },
          null,
          2,
        ) + "\n",
      )
    }

    // `workplace_type` is documented but some boards omit it. Say so instead of
    // returning an empty result that looks like "no hybrid/onsite jobs".
    const rows = data.jobs ?? []
    if (
      (opts.remote === "hybrid" || opts.remote === "onsite") &&
      rows.length > 0 &&
      !rows.some((row) => parseWorkplace(row.workplace_type) !== null)
    ) {
      process.stderr.write(
        JSON.stringify({
          warning: `this board does not expose workplace type, so --remote ${opts.remote} cannot be filtered reliably; --remote remote still uses telecommuting`,
          code: "WORKPLACE_TYPE_UNAVAILABLE",
        }) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
