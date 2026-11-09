import {
  API_BASE,
  CAMPAIGN,
  HttpError,
  fetchText,
  formatSalary,
  parseApiPage,
  withinDays,
  writeError,
  type ApiPage,
  type JobResult,
} from "../helpers.js"

export const PAGE_SIZE = 50
/** Hard cap for --all: 10 pages (500 offers) per query. Not configurable. */
export const MAX_PAGES = 10
const PAGE_DELAY_MS = 500

export interface SearchOpts {
  division: string
  query?: string
  location?: string
  experience?: string[]
  category?: string
  subcategory?: string
  minSalary?: number
  remote?: "remote" | "hybrid" | "onsite"
  jobage?: number
  page: number
  /** Sweep pages from `page` (see runSearch), capped at MAX_PAGES. */
  all?: boolean
  /** Pause between swept pages; tests pass 0. Not a CLI flag. */
  pageDelayMs?: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  params.set("campaign", CAMPAIGN)
  params.set("pageIndex", String(opts.page - 1))
  params.set("pageSize", String(PAGE_SIZE))
  // Newest first, so --jobage (client-side) keeps the head of the list.
  params.set("sortActive", "validFrom")
  params.set("sortDirection", "desc")
  if (opts.query) params.set("search.searchTerm", opts.query)
  if (opts.location) params.set("search.cities", opts.location)
  if (opts.experience?.length) params.set("search.experiences", opts.experience.join(","))
  if (opts.category) params.set("search.categories", opts.category)
  if (opts.subcategory) params.set("search.subCategories", opts.subcategory)
  if (opts.minSalary !== undefined) params.set("search.minimumSalary", String(opts.minSalary))
  return `${API_BASE}/${encodeURIComponent(opts.division)}?${params.toString()}`
}

function renderTable(jobs: JobResult[]): string {
  if (jobs.length === 0) return "No results."
  const header =
    "ID".padEnd(9) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(24) + " " +
    "LOCATION".padEnd(18) + " " + "MODE".padEnd(6) + " " + "DATE".padEnd(10) + " SALARY"
  const rows = jobs.map((j) =>
    [
      j.id.padEnd(9),
      j.title.slice(0, 40).padEnd(40),
      (j.company || "—").slice(0, 24).padEnd(24),
      (j.location || "—").slice(0, 18).padEnd(18),
      j.workplaceType.padEnd(6),
      (j.date || "—").padEnd(10),
      formatSalary(j.salary),
    ].join(" "),
  )
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    // One page, or with --all a sweep until a short page, the last page, or - since
    // results are newest first by validFrom - a page that already reaches offers
    // older than --jobage. Capped at MAX_PAGES.
    const lastPage = opts.all ? opts.page + MAX_PAGES - 1 : opts.page
    const seen = new Set<string>()
    const results: JobResult[] = []
    let page: ApiPage | null = null
    let pages = 0
    let truncated = false
    for (let p = opts.page; p <= lastPage; p++) {
      if (pages > 0) await new Promise((r) => setTimeout(r, opts.pageDelayMs ?? PAGE_DELAY_MS))
      const body = await fetchText(buildUrl({ ...opts, page: p }), "application/json")
      if (!body) {
        writeError(`Division "${opts.division}" not found`, "NOT_FOUND")
        return 1
      }
      const parsed = parseApiPage(body)
      page = parsed.page
      pages++
      for (const j of parsed.results) {
        if (seen.has(j.id)) continue
        seen.add(j.id)
        results.push(j)
      }
      const last = parsed.results[parsed.results.length - 1]
      const pastWindow = opts.jobage !== undefined && last !== undefined && !withinDays(last, opts.jobage)
      const exhausted = parsed.page.jobs.length < PAGE_SIZE || p >= parsed.page.totalPages
      if (exhausted || pastWindow) break
      if (opts.all && p === lastPage) truncated = true
    }
    if (truncated) {
      process.stderr.write(
        JSON.stringify({
          warning: `--all stopped at the ${MAX_PAGES}-page cap (${MAX_PAGES * PAGE_SIZE} offers) with more still available - narrow the query or the time window, or offers in it are missed`,
          code: "PAGE_CAP_REACHED",
        }) + "\n",
      )
    }
    let jobs = results
    if (opts.remote) jobs = jobs.filter((j) => j.workplaceType === opts.remote)
    if (opts.jobage !== undefined) jobs = jobs.filter((j) => withinDays(j, opts.jobage as number))
    if (opts.limit !== undefined) jobs = jobs.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(jobs) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        jobs
          .map(
            (j) =>
              `${j.title}\n  ${j.company || "—"} · ${j.location || "—"} · ${j.workplaceType} · ${j.date || "—"}\n` +
              `  ${formatSalary(j.salary)}\n  id: ${j.id}\n  ${j.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: jobs.length,
              page: opts.page,
              pages,
              totalCount: page?.totalCount ?? 0,
              totalPages: page?.totalPages ?? 0,
              truncated,
            },
            results: jobs,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    const code = e instanceof HttpError && e.status === 400 ? "BAD_REQUEST" : "SEARCH_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
