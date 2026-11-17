import {
  stripInvisible,
  CATEGORIES,
  FEED_URL,
  ageInDays,
  matchesQuery,
  parseFeed,
  searchableText,
  textFetch,
  writeError,
  type JobCard,
} from "../helpers.js"

/** Results per --page. The feed has no server-side paging; the CLI pages its own filtered list. */
export const PAGE_SIZE = 25

export interface SearchOpts {
  query?: string
  category?: string
  location?: string
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

/** Apply every client-side filter to the feed's postings. */
export function filterCards(cards: JobCard[], opts: SearchOpts, now: Date = new Date()): JobCard[] {
  let out = cards.filter((c) => matchesQuery(searchableText(c), opts.query))
  if (opts.category) {
    const tag = CATEGORIES[opts.category].toLowerCase()
    out = out.filter((c) => c.tags.some((t) => t.toLowerCase() === tag))
  }
  if (opts.location) {
    const want = opts.location.toLowerCase()
    out = out.filter((c) => (c.location || "").toLowerCase().includes(want))
  }
  if (opts.jobage !== undefined) {
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
    const title = c.title.slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    return `${title} ${company} ${loc} ${c.date || "—"}`
  })
  const header = "TITLE".padEnd(40) + " " + "COMPANY".padEnd(22) + " " + "WORK FROM".padEnd(24) + " POSTED"
  return [header, "-".repeat(header.length + 5), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const all = stripInvisible(parseFeed(await textFetch(FEED_URL)))
    const filtered = filterCards(all, opts)
    const total = filtered.length
    const start = (opts.page - 1) * PAGE_SIZE
    let cards = filtered.slice(start, start + PAGE_SIZE)
    if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}${c.tags.length ? ` · ${c.tags.join(", ")}` : ""}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: cards.length, page: opts.page, total, hasNext: start + PAGE_SIZE < total }, results: cards },
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
