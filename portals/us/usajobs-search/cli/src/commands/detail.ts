import { apiFetch, formatSalary, isoDate, stripInvisible, writeError, type ApiSearchResponse } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

interface DetailOutput {
  id: string
  matchedObjectId: string
  title: string
  company: string
  department: string
  location: string
  date: string | null
  deadline: string | null
  url: string
  applyUrl: string | null
  salary: string | null
  remote: boolean
  schedule: string
  whoMayApply: string
  summary: string
}

/**
 * Normalize a raw input to a usable job identifier. Accepts:
 * - a bare position ID (e.g. "USGS-DEF-CA-26-00001")
 * - a numeric MatchedObjectId (e.g. "789456123")
 * - a usajobs.gov job URL (e.g. "https://www.usajobs.gov/job/789456123/")
 * Exported for tests.
 */
export function normalizePositionId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed)) {
    let host: string
    try {
      host = new URL(trimmed).hostname.toLowerCase()
    } catch {
      return null
    }
    // Reject non-usajobs hosts — a URL from a redirect or look-alike must not
    // become a numeric keyword that happens to match a different job.
    if (host !== "www.usajobs.gov" && host !== "usajobs.gov") return null
    const m = new URL(trimmed).pathname.match(/^\/job\/(\d+)\/?$/)
    return m ? m[1] : null
  }

  // Bare alphanumeric position IDs (letters, digits, hyphens) or pure numeric IDs.
  if (/^[\w-]+$/.test(trimmed) && trimmed.length >= 4) return trimmed
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizePositionId(opts.id)
  if (!id) {
    writeError(`Could not parse a USAJobs position ID or URL from "${opts.id}"`, "BAD_ID")
    return 1
  }

  try {
    const data = await apiFetch<ApiSearchResponse>("/api/search", {
      Keyword: id,
      ResultsPerPage: "5",
    })

    const items = data.SearchResult?.SearchResultItems ?? []
    // Prefer exact MatchedObjectId match (numeric URL IDs), then PositionID match.
    const item =
      items.find((i) => i.MatchedObjectId === id) ??
      items.find((i) => i.MatchedObjectDescriptor.PositionID === id)

    if (!item) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }

    const d = item.MatchedObjectDescriptor
    const output: DetailOutput = stripInvisible({
      id: d.PositionID,
      matchedObjectId: item.MatchedObjectId,
      title: d.PositionTitle,
      company: d.OrganizationName ?? d.DepartmentName ?? "",
      department: d.DepartmentName ?? "",
      location: d.PositionLocationDisplay ?? d.PositionLocation?.[0]?.LocationName ?? "",
      date: isoDate(d.PublicationStartDate),
      deadline: isoDate(d.ApplicationCloseDate),
      url: d.PositionURI,
      applyUrl: d.ApplyURI?.[0] ?? null,
      salary: formatSalary(d.PositionRemuneration),
      remote: d.UserArea?.Details?.RemoteIndicator ?? false,
      schedule: d.PositionSchedule?.[0]?.Name ?? "",
      whoMayApply: d.UserArea?.Details?.WhoMayApply?.Name ?? "",
      summary: d.UserArea?.Details?.JobSummary ?? "",
    })

    if (opts.format === "json") {
      console.log(JSON.stringify(output, null, 2))
    } else {
      outputPlain(output)
    }

    return 0
  } catch (err) {
    writeError(err instanceof Error ? err.message : String(err), "API_ERROR")
    return 1
  }
}

function outputPlain(data: DetailOutput): void {
  console.log(`id: ${data.id}`)
  console.log(`title: ${data.title}`)
  console.log(`company: ${data.company}`)
  if (data.department && data.department !== data.company) console.log(`department: ${data.department}`)
  console.log(`location: ${data.location}`)
  if (data.date) console.log(`date: ${data.date}`)
  if (data.deadline) console.log(`deadline: ${data.deadline}`)
  if (data.salary) console.log(`salary: ${data.salary}`)
  if (data.remote) console.log(`remote: true`)
  if (data.schedule) console.log(`schedule: ${data.schedule}`)
  if (data.whoMayApply) console.log(`whoMayApply: ${data.whoMayApply}`)
  console.log(`url: ${data.url}`)
  if (data.applyUrl) console.log(`applyUrl: ${data.applyUrl}`)
  if (data.summary) {
    console.log("")
    console.log(data.summary)
  }
}
