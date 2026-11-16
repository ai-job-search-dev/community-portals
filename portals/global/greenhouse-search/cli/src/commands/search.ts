import {
  API_HOSTS,
  jsonFetch,
  matchesLocation,
  matchesQuery,
  stripInvisible,
  toCard,
  withinDays,
  writeError,
  type ApiJob,
  type JobCard,
  type Region,
} from "../helpers.js"

export const PAGE_SIZE = 20

export interface SearchOpts {
  board: string
  region: Region
  query?: string
  location?: string
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 48).padEnd(48)
    const loc = (c.location || "—").slice(0, 34).padEnd(34)
    const date = (c.date || "—").slice(0, 10)
    return `${c.id.padEnd(10)} ${title} ${loc} ${date}`
  })
  const header = "ID".padEnd(10) + " " + "TITLE".padEnd(48) + " " + "LOCATION".padEnd(34) + " POSTED"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const data = await jsonFetch<{ jobs: ApiJob[]; meta?: { total?: number } }>(
      `${API_HOSTS[opts.region]}/${opts.board}/jobs`,
    )
    if (!data) {
      writeError(`No Greenhouse job board named "${opts.board}" (HTTP 404)`, "BOARD_NOT_FOUND")
      return 1
    }

    const matched = (data.jobs ?? [])
      .map((j) => toCard(j, opts.board))
      .filter(
        (c) =>
          matchesQuery(c.title, opts.query) &&
          matchesLocation(c.location, opts.location) &&
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
              .map((c) => `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`)
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
              boardTotal: data.meta?.total ?? (data.jobs ?? []).length,
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
