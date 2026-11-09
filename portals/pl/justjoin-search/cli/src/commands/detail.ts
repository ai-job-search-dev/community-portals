import {
  BASE,
  DETAIL_PATH,
  htmlFetch,
  writeError,
  parseJobDetail,
  slugFromIdOrUrl,
  formatSalary,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = slugFromIdOrUrl(opts.id)
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
    job.skills.length ? `skills: ${job.skills.join(", ")}` : "",
    job.otherLocations.length ? `also in: ${job.otherLocations.join(", ")}` : "",
    job.url,
    "",
    job.description ?? "(no description)",
    "",
  ].filter((l) => l !== "")
  process.stdout.write(lines.join("\n") + "\n")
  return 0
}
