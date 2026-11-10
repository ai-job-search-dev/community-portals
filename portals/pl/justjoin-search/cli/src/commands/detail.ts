import {
  BASE,
  DETAIL_PATH,
  htmlFetch,
  writeError,
  parseJobDetail,
  slugFromIdOrUrl,
  formatSalary,
  isSafeSegment,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = slugFromIdOrUrl(opts.id)
  // The slug is appended to a URL path; "../api" would escape /job-offer/.
  if (!isSafeSegment(slug)) {
    writeError(`"${opts.id}" is not a valid offer slug or justjoin.it offer URL`, "BAD_ARG")
    return 1
  }
  let html: string
  try {
    html = await htmlFetch(`${BASE}${DETAIL_PATH}/${slug}`)
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "FETCH_FAILED")
    return 1
  }

  if (!html) {
    writeError(`No offer found for "${slug}" (justjoin.it returned 404)`, "NOT_FOUND")
    return 1
  }

  const job = parseJobDetail(html, slug)
  if (!job) {
    writeError(
      `Could not parse an offer out of the page for "${slug}" - the site's markup has probably changed; see url-reference.md`,
      "PARSE_FAILED",
    )
    return 1
  }

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    return 0
  }

  const lines = [
    job.title,
    `${job.company ?? "-"} | ${job.location ?? "-"}${job.street ? `, ${job.street}` : ""} | ${job.workplaceType ?? "-"}`,
    `posted ${job.date ?? "-"} | closes ${job.deadline ?? "-"} | ${job.isActive ? "open" : "EXPIRED"}`,
    `salary: ${formatSalary(job.salary)}`,
    `seniority: ${job.experienceLevel ?? "-"}`,
    job.skills.length ? `skills: ${job.skills.join(", ")}` : null,
    job.otherLocations.length ? `also in: ${job.otherLocations.join(", ")}` : null,
    job.url,
    "",
    job.description ?? "(no description)",
  ].filter((l): l is string => l !== null)
  process.stdout.write(lines.join("\n") + "\n")
  return 0
}
