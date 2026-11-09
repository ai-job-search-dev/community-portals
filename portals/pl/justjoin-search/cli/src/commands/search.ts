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

  const payload = extractRscPayload(html)
  if (html && !payload) {
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

  const rows = results.map((r) => [
    (r.title ?? "").slice(0, 44),
    (r.company ?? "-").slice(0, 22),
    (r.location ?? "-").slice(0, 14),
    (r.workplaceType ?? "-").slice(0, 7),
    r.date ?? "-",
    formatSalary(r.salary).slice(0, 32),
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
