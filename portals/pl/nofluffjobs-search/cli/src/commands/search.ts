import {
  BASE,
  SEARCH_PATH,
  DETAIL_PATH,
  htmlFetch,
  writeError,
  parseCards,
  mainListing,
  parseJsonLdPosting,
  filterByAge,
  listingDates,
  buildCriteria,
  citySlug,
  formatSalary,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  category?: string
  seniority?: string
  page: number
  /** Read the 10-page cumulative view (offers 1..200) in one request. */
  all?: boolean
  jobage?: number
  dates: boolean
  limit?: number
  format: "json" | "table" | "plain"
}

/** Hard cap for --all: the 10-page view, 200 offers. Not configurable. */
export const MAX_PAGES = 10
/** Detail-page date fallbacks per search, for results the page state left undated. */
export const MAX_ENRICHED = 30

export function buildSearchUrl(opts: SearchOpts): string {
  const criteria = buildCriteria({
    keyword: opts.query,
    city: citySlug(opts.location),
    category: opts.category,
    seniority: opts.seniority,
  })
  // Built by hand rather than with URLSearchParams: that encodes spaces as "+",
  // and the criteria syntax verified against the live portal uses %20.
  const params: string[] = []
  if (criteria) params.push(`criteria=${encodeURIComponent(criteria)}`)
  // Always newest-first, never relevance: under relevance a fresh posting can
  // rank below the --limit cut-off and be silently missed. Not a flag on purpose.
  params.push("sort=newest")
  // The portal accumulates (?page=N returns offers 1..20N), so --all is the
  // 10-page view in a single request rather than ten.
  const page = opts.all ? MAX_PAGES : opts.page
  if (page > 1) params.push(`page=${page}`)
  return BASE + SEARCH_PATH + `?${params.join("&")}`
}

/**
 * Listing cards carry no publication date, so a date costs one extra request per
 * posting. This is opt-in (`--dates`, implied by `--jobage`) and deliberately
 * sequential with a small pause: the portal is read politely, not crawled.
 */
async function enrichDates(cards: JobCard[]): Promise<JobCard[]> {
  const out: JobCard[] = []
  for (const card of cards) {
    let date: string | null = null
    try {
      const html = await htmlFetch(`${BASE}${DETAIL_PATH}/${card.id}`)
      const posting = html ? parseJsonLdPosting(html) : null
      const raw = posting?.datePosted
      date = typeof raw === "string" && raw !== "" ? raw : null
    } catch {
      // a posting whose detail page failed keeps a null date rather than
      // aborting the whole search
    }
    out.push({ ...card, date })
    await new Promise((r) => setTimeout(r, 150))
  }
  return out
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  let html: string
  try {
    html = await htmlFetch(buildSearchUrl(opts))
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "FETCH_FAILED")
    return 1
  }

  // htmlFetch maps a 404 to "": that is not a successful search with no results.
  if (!html) {
    writeError(`nofluffjobs.com has no listing page for this search (HTTP 404): ${buildSearchUrl(opts)}`, "NOT_FOUND")
    return 1
  }

  let results = parseCards(mainListing(html))
  if (results.length === 0 && !/nfj-postings-item/.test(html)) {
    writeError(
      "nofluffjobs.com returned a page with no posting cards - the site's markup has probably changed; see url-reference.md for the parsing anchors",
      "PARSE_FAILED",
    )
    return 1
  }

  // Dates come free from the page's embedded state. Only results it leaves
  // undated fall back to a detail-page request each, capped at MAX_ENRICHED.
  const { dates, total } = listingDates(html)
  results = results.map((r) => ({ ...r, date: dates.get(r.id) ?? r.date }))
  const fetchedCount = results.length

  if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)
  if (opts.dates || opts.jobage !== undefined) {
    const undated = results.filter((r) => !r.date).slice(0, MAX_ENRICHED)
    if (undated.length > 0) {
      const enriched = new Map((await enrichDates(undated)).map((r) => [r.id, r.date]))
      results = results.map((r) => (enriched.has(r.id) ? { ...r, date: enriched.get(r.id) ?? null } : r))
    }
  }
  if (opts.jobage !== undefined) results = filterByAge(results, opts.jobage)

  // More matches on the portal than the 10-page view returned: some were not read.
  const truncated = Boolean(opts.all) && total !== null && total > fetchedCount
  if (truncated) {
    process.stderr.write(
      JSON.stringify({
        warning: `--all read the ${MAX_PAGES}-page view (${fetchedCount} of ${total} matches) - narrow the query, or postings beyond it are missed`,
        code: "PAGE_CAP_REACHED",
      }) + "\n",
    )
  }

  if (opts.format === "json") {
    process.stdout.write(
      JSON.stringify(
        { meta: { count: results.length, page: opts.all ? MAX_PAGES : opts.page, total, truncated }, results },
        null,
        2,
      ) + "\n",
    )
    return 0
  }

  if (results.length === 0) {
    process.stdout.write("No offers found.\n")
    return 0
  }

  if (opts.format === "plain") {
    for (const r of results) {
      process.stdout.write(
        `${r.title}\n  ${r.company ?? "-"} | ${r.location ?? "-"}${r.extraLocations ? ` +${r.extraLocations}` : ""}\n` +
          `  ${r.date ?? "date not fetched"} | ${formatSalary(r.salary)}\n  ${r.tags.join(", ")}\n  ${r.url}\n\n`,
      )
    }
    return 0
  }

  const rows = results.map((r) => [
    (r.title ?? "").slice(0, 44),
    (r.company ?? "-").slice(0, 22),
    (r.location ?? "-").slice(0, 14),
    r.date ?? "-",
    formatSalary(r.salary).slice(0, 22),
  ])
  const headers = ["TITLE", "COMPANY", "LOCATION", "POSTED", "SALARY"]
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)))
  const line = (cells: string[]) => cells.map((c, i) => (c ?? "").padEnd(widths[i]!)).join("  ").trimEnd()
  process.stdout.write(line(headers) + "\n")
  process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n")
  for (const r of rows) process.stdout.write(line(r) + "\n")
  return 0
}
