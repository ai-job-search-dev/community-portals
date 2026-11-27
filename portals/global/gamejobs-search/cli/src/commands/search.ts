import {
  stripInvisible,
  SEARCH_URL,
  ageInDays,
  ageParam,
  htmlFetch,
  parseSearch,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("q", opts.query)
  if (opts.location) params.set("w", opts.location)
  const a = ageParam(opts.jobage)
  if (a) params.set("a", a)
  if (opts.page > 1) params.set("p", String(opts.page))
  const qs = params.toString()
  return qs ? `${SEARCH_URL}?${qs}` : SEARCH_URL
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 44).padEnd(44)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    return `${title} ${company} ${loc} ${c.dateText || "—"}`
  })
  const header = "TITLE".padEnd(44) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(24) + " POSTED"
  return [header, "-".repeat(header.length + 6), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const page = parseSearch(await htmlFetch(buildUrl(opts)))
    let cards = stripInvisible(page.results)
    // The board's age filter only has 1d/7d/31d windows; narrow to the exact
    // request here. Undated cards are kept: dropping them would hide postings
    // whose age the board simply phrased differently.
    if (opts.jobage !== undefined && opts.jobage < 9999) {
      const max = opts.jobage
      cards = cards.filter((c) => {
        const age = ageInDays(c.date)
        return age === null || age <= max
      })
    }
    if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map((c) => `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.dateText || "—"}\n  id: ${c.id}\n  ${c.url}`)
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: cards.length, page: opts.page, total: page.total, hasNext: page.hasNext }, results: cards },
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
