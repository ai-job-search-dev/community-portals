import {
  apiGet,
  cleanHtml,
  extractSlug,
  toResult,
  writeError,
  type HimalayasJob,
  type JobResult,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export interface DetailResult extends JobResult {
  fullDescription: string | null
  categories: string[]
  timezoneRestrictions?: number[]
}

function matchesIdentifier(job: HimalayasJob, target: string): boolean {
  const t = target.toLowerCase().trim()
  const rawUrl = (job.applicationLink || job.guid || "").toLowerCase()
  // No link means no slug: without this guard `t.endsWith("")` matches every job.
  if (!rawUrl) return false
  const slug = extractSlug(rawUrl).toLowerCase()

  if (rawUrl === t) return true
  if (slug && slug === t) return true

  // A numeric id is accepted only as the whole trailing id of the slug.
  const numMatch = slug.match(/(\d{6,})$/)
  if (numMatch && numMatch[1] === t) return true

  return false
}

function renderPlain(job: DetailResult): string {
  // null marks an absent field; "" is a deliberate blank separator line and must survive.
  const lines: Array<string | null> = [
    job.title,
    `${job.company ?? "—"} · ${job.location ?? "—"}`,
    "",
    job.date ? `Posted: ${job.date}` : null,
    job.seniority ? `Seniority: ${job.seniority}` : null,
    job.type ? `Employment: ${job.type}` : null,
    job.salary ? `Salary: ${job.salary}` : null,
    job.categories && job.categories.length > 0 ? `Categories: ${job.categories.join(", ")}` : null,
    "",
    job.fullDescription || job.description || "(no description)",
    "",
    `Apply URL: ${job.apply_url}`,
    `ID: ${job.id}`,
  ]

  return lines.filter((l) => l !== null).join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  // Normalise first: a browser URL with a trailing slash or ?query must match like the slug does.
  const target = extractSlug(opts.id)
  if (!target) {
    writeError("detail requires an <id|slug|url>", "NO_ID")
    return 1
  }

  try {
    // Walk the feed until the posting is found or the feed ends,
    // bounded so a miss cannot page forever.
    let foundJob: HimalayasJob | null = null
    const pageSize = 20
    const maxPages = 50

    for (let p = 0; p < maxPages; p++) {
      const data = await apiGet({ limit: pageSize, offset: p * pageSize })
      const jobs = data.jobs || []
      if (jobs.length === 0) break

      for (const job of jobs) {
        if (matchesIdentifier(job, target)) {
          foundJob = job
          break
        }
      }
      if (foundJob) break
      if (jobs.length < pageSize) break
    }

    if (!foundJob) {
      writeError(`Job not found for "${target}"`, "NOT_FOUND")
      return 1
    }

    const base = toResult(foundJob)
    const detailResult: DetailResult = {
      ...base,
      fullDescription: cleanHtml(foundJob.description) || base.description,
      categories: foundJob.categories || [],
      timezoneRestrictions: foundJob.timezoneRestrictions,
    }

    if (opts.format === "plain") {
      process.stdout.write(renderPlain(detailResult) + "\n")
    } else {
      process.stdout.write(JSON.stringify(detailResult, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
