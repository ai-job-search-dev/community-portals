import { BASE_URL, detailTarget, htmlFetch, parseJobDetail, stripInvisible, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const target = detailTarget(opts.id)
  if (!target) {
    writeError(`Could not parse a Djinni job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const url = BASE_URL + target.path
    const html = await htmlFetch(url)
    const parsed = html ? parseJobDetail(html, target.id, url) : null
    if (!parsed) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      // Absent fields are null and dropped; "" lines are the section breaks and stay.
      const facts = [
        job.date ? `Posted: ${job.date}` : null,
        job.validThrough ? `Valid through: ${job.validThrough}` : null,
        job.workplace ? `Workplace: ${job.workplace}` : null,
        job.offices.length ? `Offices: ${job.offices.join(", ")}` : null,
        job.employmentType ? `Employment: ${job.employmentType}` : null,
        job.experienceYears !== null ? `Experience: ${job.experienceYears}+ years` : null,
        job.languages.length ? `Languages: ${job.languages.join("; ")}` : job.english ? `English: ${job.english}` : null,
        job.salary ? `Salary: ${job.salary}` : job.salaryTier ? `Salary tier: ${job.salaryTier}` : null,
        job.category ? `Category: ${job.category}` : null,
      ].filter((l): l is string => l !== null)
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        ...(facts.length ? ["", ...facts] : []),
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ]
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
