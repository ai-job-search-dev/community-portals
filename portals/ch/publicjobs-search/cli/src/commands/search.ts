import { fetchSitemapCached, matchesQuery, parseSitemap, squash, stripInvisible, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  category?: string
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export const PAGE_SIZE = 20

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header = `${"ID".padEnd(7)} ${"TITLE (from URL slug)".padEnd(60)} ${"CANTON".padEnd(14)} CATEGORY`
  const rows = cards.map(
    (c) =>
      `${c.id.padEnd(7)} ${c.title.slice(0, 60).padEnd(60)} ${(c.location || "—").slice(0, 14).padEnd(14)} ${c.category || "—"}`,
  )
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

/** --location matches the canton name, its two-letter code, or the region slug. */
function matchesLocation(loc: string | undefined, c: JobCard): boolean {
  if (!loc) return true
  const want = squash(loc)
  // Two letters are a canton code only: "UR" must not substring-match "Thurgau".
  if (want.length <= 2) return !!c.canton && want === c.canton.toLowerCase()
  return squash(c.location ?? "").includes(want)
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  let xml: string
  try {
    xml = await fetchSitemapCached()
  } catch (e) {
    writeError(`could not fetch the publicjobs.ch sitemap: ${e instanceof Error ? e.message : String(e)}`, "SEARCH_FAILED")
    return 1
  }
  const listed = parseSitemap(xml)
  if (listed.length === 0) {
    writeError("the publicjobs.ch sitemap contained no job postings (markup change?)", "SEARCH_FAILED")
    return 1
  }

  // The title slug is the only title text in the sitemap; the category is
  // matched only through --category, so "IT" does not match every IT posting.
  const matched = listed
    .filter(
      (c) =>
        matchesQuery(opts.query, c.slug) &&
        matchesLocation(opts.location, c) &&
        (!opts.category || squash(c.category ?? "").includes(squash(opts.category))),
    )
    // Posting ids increase as postings are created: highest id first is the
    // closest the sitemap gets to newest first.
    .sort((a, b) => Number(b.id) - Number(a.id))

  let cards = matched.slice((opts.page - 1) * PAGE_SIZE, opts.page * PAGE_SIZE)
  if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)
  cards = stripInvisible(cards)

  if (opts.format === "table") {
    process.stdout.write(renderTable(cards) + "\n")
  } else if (opts.format === "plain") {
    process.stdout.write(
      (cards.length
        ? cards
            .map((c) => `${c.title}\n  ${c.location || "—"} · ${c.category || "—"}\n  id: ${c.id}\n  ${c.url}`)
            .join("\n\n")
        : "No results.") + "\n",
    )
  } else {
    process.stdout.write(
      JSON.stringify(
        {
          meta: {
            count: cards.length,
            page: opts.page,
            total: matched.length,
            numPages: Math.ceil(matched.length / PAGE_SIZE),
            listed: listed.length,
          },
          results: cards,
        },
        null,
        2,
      ) + "\n",
    )
  }
  return 0
}
