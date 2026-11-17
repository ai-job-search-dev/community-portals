import { stripInvisible, htmlFetch, normalizeSlug, parseDetail, postingUrl, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = normalizeSlug(opts.id)
  if (!slug) {
    writeError(`Could not parse a GameJobs.co posting slug from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(postingUrl(slug))
    if (!html) {
      writeError("Job not found (the posting may have been removed)", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parseDetail(html, slug))

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.date ? `Posted: ${job.date}${job.dateText ? ` (${job.dateText})` : ""}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.deadline ? `Valid through: ${job.deadline}` : "",
        `Status: ${job.isActive ? "ACTIVE" : "CLOSED / EXPIRED"}`,
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
        job.applyUrl ? `Apply: ${job.applyUrl}` : "",
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
