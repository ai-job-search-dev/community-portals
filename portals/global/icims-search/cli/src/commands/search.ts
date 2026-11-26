import {
  htmlFetch,
  matchesLocation,
  matchesWorkplace,
  parseSearchPage,
  searchUrl,
  stripInvisible,
  withinDays,
  writeError,
  type JobCard,
  type PortalRef,
  type Workplace,
} from "../helpers.js"

export interface SearchOpts {
  portal: PortalRef
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
  const header =
    "TITLE".padEnd(48) + " " + "LOCATION".padEnd(34) + " " + "WORKPLACE".padEnd(10) + " " + "POSTED".padEnd(10) + " ID"
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 48).padEnd(48)
    const loc = (c.location || "—").slice(0, 34).padEnd(34)
    const workplace = (c.workplace || "—").padEnd(10)
    const date = (c.date || "—").slice(0, 10).padEnd(10)
    return `${title} ${loc} ${workplace} ${date} ${c.id}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(searchUrl(opts.portal.origin, opts.page, opts.query))
    if (html === null) {
      writeError(`No iCIMS portal at ${opts.portal.host} (unknown host, or the portal closed)`, "PORTAL_NOT_FOUND")
      return 1
    }
    // A 200 that carries no iCIMS markup is a WAF/interstitial page, not an
    // empty board. Reporting it as "no results" would hide the block.
    if (!/iCIMS_/.test(html)) {
      writeError(
        `${opts.portal.host} answered with a page that does not look like an iCIMS portal (blocked, or not a portal host)`,
        "SEARCH_FAILED",
      )
      return 1
    }

    const page = parseSearchPage(html, opts.portal.origin, opts.portal.label)
    // Sanitize before matching, so an invisible character cannot hide a visible match.
    // A card with no date cannot be judged by a date filter, and many portals
    // print none at all: dropping them would make the whole board read empty.
    // /scrape's own date check gets the final say on those.
    const matched = page.jobs
      .map(stripInvisible)
      .filter(
        (c) =>
          matchesLocation(c.location, opts.location) &&
          matchesWorkplace(c, opts.remote) &&
          (c.date === null || withinDays(c.date, opts.jobage)),
      )
    const cards = opts.limit !== undefined ? matched.slice(0, opts.limit) : matched

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (cards.length === 0
          ? "No results."
          : cards
              .map(
                (c) =>
                  `${c.title}\n  ${c.company} · ${c.location || "—"} · ${c.date || "—"}${c.workplace ? ` · ${c.workplace}` : ""}\n  id: ${c.id}\n  ${c.url}`,
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
              portal: opts.portal.label,
              matched: matched.length,
              totalPages: page.totalPages,
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
