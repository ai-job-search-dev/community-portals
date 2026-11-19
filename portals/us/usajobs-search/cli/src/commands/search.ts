import { apiFetch, formatSalary, isoDate, stripInvisible, writeError, type ApiSearchResponse, type JobDescriptor } from "../helpers.js"

export interface SearchOpts {
  keyword?: string
  location?: string
  days?: number
  remote: boolean
  page: number
  perPage: number
  limit?: number
  format: "json" | "table" | "plain"
}

export interface SearchResult {
  id: string
  title: string
  company: string
  location: string
  date: string | null
  deadline: string | null
  url: string
  salary: string | null
  remote: boolean
  schedule: string
}

export function toSearchResult(d: JobDescriptor): SearchResult {
  return {
    id: d.PositionID,
    title: d.PositionTitle,
    company: d.OrganizationName ?? d.DepartmentName ?? "",
    location: d.PositionLocationDisplay ?? d.PositionLocation?.[0]?.LocationName ?? "",
    date: isoDate(d.PublicationStartDate),
    deadline: isoDate(d.ApplicationCloseDate),
    url: d.PositionURI,
    salary: formatSalary(d.PositionRemuneration),
    remote: d.UserArea?.Details?.RemoteIndicator ?? false,
    schedule: d.PositionSchedule?.[0]?.Name ?? "",
  }
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const params: Record<string, string> = {
    ResultsPerPage: String(opts.perPage),
    Page: String(opts.page),
  }
  if (opts.keyword) params.Keyword = opts.keyword
  if (opts.location) params.LocationName = opts.location
  if (opts.days) params.DatePosted = String(opts.days)
  if (opts.remote) params.RemoteIndicator = "True"

  try {
    const data = await apiFetch<ApiSearchResponse>("/api/search", params)
    const items = data.SearchResult?.SearchResultItems ?? []
    let results = items.map((item) => toSearchResult(item.MatchedObjectDescriptor))
    const totalAvailable = data.SearchResult?.SearchResultCountAll ?? 0

    if (opts.limit !== undefined && opts.limit > results.length && results.length === opts.perPage) {
      let nextPage = opts.page + 1
      while (results.length < opts.limit && results.length < totalAvailable) {
        const more = await apiFetch<ApiSearchResponse>("/api/search", { ...params, Page: String(nextPage) })
        const moreItems = more.SearchResult?.SearchResultItems ?? []
        if (moreItems.length === 0) break
        results.push(...moreItems.map((item) => toSearchResult(item.MatchedObjectDescriptor)))
        nextPage++
      }
    }

    if (opts.limit !== undefined) results = results.slice(0, opts.limit)

    const output = {
      meta: {
        count: results.length,
        totalCount: data.SearchResult?.SearchResultCountAll ?? 0,
        page: opts.page,
      },
      results: stripInvisible(results),
    }

    if (opts.format === "json") {
      console.log(JSON.stringify(output, null, 2))
    } else if (opts.format === "table") {
      outputTable(output.results)
    } else {
      outputPlain(output.results)
    }

    return 0
  } catch (err) {
    writeError(err instanceof Error ? err.message : String(err), "API_ERROR")
    return 1
  }
}

function outputTable(results: SearchResult[]): void {
  if (results.length === 0) {
    console.log("(no results)")
    return
  }
  const idW = Math.max(6, ...results.map((r) => r.id.length))
  const titleW = Math.min(40, Math.max(5, ...results.map((r) => r.title.length)))
  const orgW = Math.min(28, Math.max(7, ...results.map((r) => r.company.length)))
  const locW = Math.min(24, Math.max(8, ...results.map((r) => r.location.length)))

  console.log(
    "id".padEnd(idW) + "  " +
    "title".padEnd(titleW) + "  " +
    "company".padEnd(orgW) + "  " +
    "location".padEnd(locW) + "  " +
    "date".padEnd(10) + "  salary",
  )
  for (const r of results) {
    console.log(
      r.id.padEnd(idW) + "  " +
      r.title.substring(0, titleW).padEnd(titleW) + "  " +
      r.company.substring(0, orgW).padEnd(orgW) + "  " +
      r.location.substring(0, locW).padEnd(locW) + "  " +
      (r.date ?? "-").padEnd(10) + "  " +
      (r.salary ?? "-"),
    )
  }
}

function outputPlain(results: SearchResult[]): void {
  for (const r of results) {
    console.log(`id: ${r.id}`)
    console.log(`title: ${r.title}`)
    console.log(`company: ${r.company}`)
    console.log(`location: ${r.location}`)
    if (r.date) console.log(`date: ${r.date}`)
    if (r.deadline) console.log(`deadline: ${r.deadline}`)
    if (r.salary) console.log(`salary: ${r.salary}`)
    if (r.remote) console.log(`remote: true`)
    console.log(`schedule: ${r.schedule}`)
    console.log(`url: ${r.url}`)
    console.log("")
  }
}
