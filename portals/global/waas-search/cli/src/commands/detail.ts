import {
  BASE_URL,
  htmlFetch,
  parseDataPage,
  parseJobDetail,
  writeError,
  type WaasJobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw job ID or a workatastartup.com job URL */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  const bare = trimmed.match(/^(\d+)$/)
  if (bare) return bare[1]

  try {
    const url = new URL(trimmed)
    const host = url.hostname.toLowerCase()
    if (host !== "workatastartup.com" && host !== "www.workatastartup.com") {
      return null
    }
    const match = url.pathname.match(/^\/jobs\/(\d+)\/?$/)
    if (match) return match[1]
  } catch {
    // Not a valid URL
  }

  return null
}

export function renderDetailPlain(job: WaasJobDetail): string {
  const lines: (string | null)[] = [
    job.title,
    `${job.company}${job.batch ? ` (${job.batch})` : ""} · ${job.location || "Location not listed"}`,
    "",
    job.salary ? `Salary: ${job.salary}` : null,
    job.equity ? `Equity: ${job.equity}` : null,
    job.jobType ? `Employment: ${job.jobType}` : null,
    job.minExperience ? `Experience: ${job.minExperience}` : null,
    job.sponsorsVisa ? `Visa Sponsorship: ${job.sponsorsVisa}` : null,
    job.skills.length > 0 ? `Skills: ${job.skills.join(", ")}` : null,
    "",
    "--- JOB DESCRIPTION ---",
    job.description || "(no description provided)",
  ]

  if (job.companyDescription || job.techDescription || job.hiringDescription) {
    lines.push("", "--- ABOUT COMPANY ---")
    if (job.companyDescription) lines.push(job.companyDescription)
    if (job.techDescription) lines.push("", "Tech Stack:", job.techDescription)
    if (job.hiringDescription) lines.push("", "Hiring Philosophy:", job.hiringDescription)
  }

  lines.push(
    "",
    `Listing URL: ${job.url}`,
    job.applyUrl
      ? `Apply URL: ${job.applyUrl} (Note: applying requires a Y Combinator login, but viewing details does not.)`
      : "Apply URL: unavailable",
  )

  return lines.filter((l): l is string => l !== null).join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job ID from "${opts.id}"`, "BAD_ID")
    return 1
  }

  try {
    const url = `${BASE_URL}/jobs/${id}`
    const html = await htmlFetch(url)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }

    const data = parseDataPage(html)
    if (!data?.props?.job) {
      writeError("Failed to parse job page payload", "PARSE_FAILED")
      return 1
    }

    const detail = parseJobDetail(data, id)

    if (opts.format === "plain") {
      process.stdout.write(renderDetailPlain(detail) + "\n")
    } else {
      process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
