import {
  BASE,
  SEARCH_PATH,
  htmlFetch,
  writeError,
  extractRscPayload,
  parseOffers,
  normalizeOffer,
  filterByAge,
  locationSlug,
  formatSalary,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  category?: string
  workplace?: string
  experience?: string
  employmentType?: string
  withSalary?: boolean
  jobage: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildSearchUrl(opts: SearchOpts): string {
  const segments = [SEARCH_PATH, locationSlug(opts.location)]
  if (opts.category) segments.push(opts.category)
  const url = new URL(BASE + segments.join("/"))
  if (opts.query) url.searchParams.set("keyword", opts.query)
  if (opts.workplace) url.searchParams.set("workplace", opts.workplace)
  if (opts.experience) url.searchParams.set("experience-level", opts.experience)
  if (opts.employmentType) url.searchParams.set("employment-type", opts.employmentType)
  if (opts.withSalary) url.searchParams.set("with-salary", "yes")
  // justjoin's default order is relevance; published-first is what a scraper wants.
  url.searchParams.set("orderBy", "DESC")
  url.searchParams.set("sortBy", "published")
  return url.toString()
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  let html: string
  try {
    html = await htmlFetch(buildSearchUrl(opts))
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "FETCH_FAILED")
    return 1
  }

  // htmlFetch maps a 404 to "". An unknown category or location is a 404, and
  // must not read as a successful search that simply found nothing.
  if (!html) {
    writeError(
      `justjoin.it has no listing page for this search (HTTP 404) - check --category and --location: ${buildSearchUrl(opts)}`,
      "NOT_FOUND",
    )
    return 1
  }

  const payload = extractRscPayload(html)
  if (!payload) {
    writeError(
      "justjoin.it returned a page with no readable data payload - the site's rendering has probably changed; see url-reference.md for the parsing anchors",
      "PARSE_FAILED",
    )
    return 1
  }

  const cards = parseOffers(payload)
    .map(normalizeOffer)
    .filter((c): c is JobCard => c !== null)

  let results = filterByAge(cards, opts.jobage)
  if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

  if (opts.format === "json") {
    process.stdout.write(
      JSON.stringify({ meta: { count: results.length, page: 1 }, results }, null, 2) + "\n",
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
        `${r.title}\n  ${r.company ?? "-"} | ${r.location ?? "-"} | ${r.workplaceType ?? "-"}\n` +
          `  ${r.date ?? "-"} | closes ${r.deadline ?? "-"} | ${formatSalary(r.salary)}\n  ${r.url}\n\n`,
      )
    }
    return 0
  }

  // Truncate with a marker so a cut-off value cannot pass for a complete one.
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s)
  const rows = results.map((r) => [
    clip(r.title ?? "", 44),
    clip(r.company ?? "-", 22),
    clip(r.location ?? "-", 14),
    clip(r.workplaceType ?? "-", 7),
    r.date ?? "-",
    clip(formatSalary(r.salary), 32),
  ])
  const headers = ["TITLE", "COMPANY", "CITY", "MODE", "POSTED", "SALARY"]
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  )
  const line = (cells: string[]) =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i]!)).join("  ").trimEnd()
  process.stdout.write(line(headers) + "\n")
  process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n")
  for (const r of rows) process.stdout.write(line(r) + "\n")
  return 0
}
