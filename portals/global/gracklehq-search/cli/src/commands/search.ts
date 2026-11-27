import {
  stripInvisible,
  ageInDays,
  buildUrl,
  htmlFetch,
  parseJobs,
  startsAtWord,
  writeError,
  type JobCard,
} from "../helpers.js"

/** With --jobage and no --page, follow Next while the newest-first list is still in range, up to this many pages. */
export const MAX_AUTO_PAGES = 5

export interface SearchOpts {
  query?: string
  location?: string
  department?: string
  jobage?: number
  page?: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header = "TITLE".padEnd(46) + " " + "COMPANY".padEnd(22) + " " + "LOCATION".padEnd(24) + " AGE"
  const rows = cards.map(
    (c) =>
      `${c.title.slice(0, 46).padEnd(46)} ${(c.company || "—").slice(0, 22).padEnd(22)} ${(c.location || "—")
        .slice(0, 24)
        .padEnd(24)} ${c.dateText || "—"}`,
  )
  return [header, "-".repeat(header.length + 4), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const autoPage = opts.jobage !== undefined && opts.page === undefined
    let page = opts.page ?? 1
    const first = parseJobs(await htmlFetch(buildUrl({ ...opts, page })))
    let cards = first.results
    let hasNext = first.hasNext
    let pagesRead = 1
    // Newest first: keep reading while the last card is still inside the window.
    const kept = (list: JobCard[]) => list.filter((c) => startsAtWord(c.title, opts.query)).length
    while (autoPage && hasNext && pagesRead < MAX_AUTO_PAGES) {
      const lastAge = ageInDays(cards[cards.length - 1]?.date ?? null)
      if (lastAge === null || lastAge > (opts.jobage as number)) break
      // Enough results for --limit already: no more pages.
      if (opts.limit !== undefined && kept(cards) >= opts.limit) break
      await new Promise((r) => setTimeout(r, 1000))
      page++
      const next = parseJobs(await htmlFetch(buildUrl({ ...opts, page })))
      cards = cards.concat(next.results)
      hasNext = next.hasNext
      pagesRead++
    }

    cards = stripInvisible(cards).filter((c) => startsAtWord(c.title, opts.query))
    if (opts.jobage !== undefined) {
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
          { meta: { count: cards.length, page: opts.page ?? 1, pagesRead, total: first.total, hasNext }, results: cards },
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
