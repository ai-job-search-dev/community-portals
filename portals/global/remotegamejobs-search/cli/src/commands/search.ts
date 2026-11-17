import {
  stripInvisible,
  FEED_URL,
  SEARCH_URL,
  ageInDays,
  categoryUrl,
  parseCards,
  parseFeedDates,
  textFetch,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  category?: string
  location?: string
  jobage?: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function searchUrl(query: string | undefined): string {
  return `${SEARCH_URL}?${new URLSearchParams({ query: query ?? "" }).toString()}`
}

/**
 * Collect cards. The board's search is full text and returns every match on one
 * page; a category page lists every open posting in that category. With both
 * flags, the two lists are intersected so the full-text match is kept.
 */
async function collect(opts: SearchOpts): Promise<JobCard[]> {
  const bySearch = opts.query || !opts.category ? parseCards(await textFetch(searchUrl(opts.query))) : null
  const byCategory = opts.category ? parseCards(await textFetch(categoryUrl(opts.category))) : null
  if (bySearch && byCategory) {
    const inCategory = new Set(byCategory.map((c) => c.id))
    return bySearch.filter((c) => inCategory.has(c.id))
  }
  return bySearch ?? byCategory ?? []
}

/** Attach feed dates, then apply the client-side --location and --jobage filters. */
export function finish(cards: JobCard[], dates: Map<string, string>, opts: SearchOpts, now: Date = new Date()): JobCard[] {
  let out = cards.map((c) => ({ ...c, date: dates.get(c.id) ?? null }))
  if (opts.location) {
    const want = opts.location.toLowerCase()
    out = out.filter((c) => (c.location || "").toLowerCase().includes(want))
  }
  if (opts.jobage !== undefined) {
    // Postings older than the feed carry no date. They are still listed on the
    // board (it removes closed postings), so they are kept rather than guessed at.
    out = out.filter((c) => {
      const age = ageInDays(c.date, now)
      return age === null || age <= opts.jobage!
    })
  }
  return out
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 38).padEnd(38)
    const company = (c.company || "—").slice(0, 20).padEnd(20)
    const scope = (c.location || "—").slice(0, 30).padEnd(30)
    return `${title} ${company} ${scope} ${c.date || "—"}`
  })
  const header = "TITLE".padEnd(38) + " " + "COMPANY".padEnd(20) + " " + "REMOTE SCOPE".padEnd(30) + " POSTED"
  return [header, "-".repeat(header.length + 5), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const cards = await collect(opts)
    const dates = cards.length ? parseFeedDates(await textFetch(FEED_URL)) : new Map<string, string>()
    let out = stripInvisible(finish(cards, dates, opts))
    const total = out.length
    if (opts.limit !== undefined) out = out.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(out) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        out
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}` +
              `${[c.category, ...c.tags].filter(Boolean).length ? ` · ${[c.category, ...c.tags].filter(Boolean).join(", ")}` : ""}` +
              `${c.salary ? ` · ${c.salary}` : ""}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: out.length, page: 1, total, hasNext: false }, results: out }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
