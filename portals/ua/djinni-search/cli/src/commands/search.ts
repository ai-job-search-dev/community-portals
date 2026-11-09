import {
  SEARCH_URL,
  htmlFetch,
  parseSearchPage,
  parseTotal,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  /** A Djinni category name, already normalized to Djinni's spelling. */
  category?: string
  /** Djinni's search_type value: basic-search | full-text | title-only. */
  searchType?: string
  employment?: string
  /** A Djinni city slug. */
  location?: string
  /** Djinni's region value: worldwide | UKR | eu | other. */
  region?: string
  salary?: number
  publicSalary?: boolean
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) {
    params.set("all_keywords", opts.query)
    params.set("search_type", opts.searchType ?? "basic-search")
  }
  if (opts.category) params.set("primary_keyword", opts.category)
  if (opts.employment) params.set("employment", opts.employment)
  if (opts.location) params.set("location", opts.location)
  if (opts.region) params.set("region", opts.region)
  if (opts.salary !== undefined) params.set("salary", String(opts.salary))
  if (opts.publicSalary) params.set("editorial", "has_public_salary")
  if (opts.page > 1) params.set("page", String(opts.page))
  const qs = params.toString()
  return qs ? `${SEARCH_URL}?${qs}` : SEARCH_URL
}

function pay(c: JobCard): string {
  return c.salary || c.salaryTier || "—"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 44).padEnd(44)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 26).padEnd(26)
    const date = (c.date || "—").padEnd(10)
    return `${c.id.padEnd(7)} ${title} ${company} ${loc} ${date} ${pay(c)}`
  })
  const header =
    "ID".padEnd(7) +
    " " +
    "TITLE".padEnd(44) +
    " " +
    "COMPANY".padEnd(22) +
    " " +
    "LOCATION".padEnd(26) +
    " " +
    "DATE".padEnd(10) +
    " SALARY"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(cards: JobCard[]): string {
  return cards
    .map((c) => {
      const facts = [
        c.remoteOnly ? "remote only" : c.offices.length ? `office: ${c.offices.join(", ")}` : null,
        c.english ? `English ${c.english}` : null,
        c.experienceYears !== null ? `${c.experienceYears}+ yrs` : null,
        c.salary || c.salaryTier,
      ].filter(Boolean)
      return [
        c.title,
        `  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}`,
        facts.length ? `  ${facts.join(" · ")}` : null,
        `  id: ${c.id}`,
        `  ${c.url}`,
      ]
        .filter((l) => l !== null)
        .join("\n")
    })
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(buildUrl(opts))
    let cards = stripInvisible(parseSearchPage(html, { maxAgeDays: opts.jobage }))
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(cards) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: cards.length, page: opts.page, total: parseTotal(html) }, results: cards },
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
