import { stripInvisible, normalizeSlug, parseDetail, postingUrl, textFetch, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = normalizeSlug(opts.id)
  if (!slug) {
    writeError(`Could not parse a Remote Game Jobs posting slug from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await textFetch(postingUrl(slug))
    if (!html) {
      writeError("Job not found (the posting may have been removed)", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parseDetail(html, slug))

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"}${job.category ? ` · ${job.category}` : ""}`,
        "",
        job.location ? `Remote scope: ${job.location}` : "",
        job.applicantLocation ? `Applicants from: ${job.applicantLocation}` : "",
        job.tags.length ? `Type · level: ${job.tags.join(" · ")}` : "",
        job.salary ? `Salary: ${job.salary}` : "",
        job.date ? `Posted: ${job.date}` : "",
        job.deadline ? `Valid through: ${job.deadline}` : "",
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
