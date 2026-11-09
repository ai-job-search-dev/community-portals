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
    writeError(`No offer found for "${slug}" (nofluffjobs.com returned 404)`, "NOT_FOUND")
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

  const blocks = [
    job.title,
    `${job.company ?? "-"} | ${job.location ?? "-"}${job.street ? `, ${job.street}` : ""}`,
    `posted ${job.date ?? "-"} | ${job.employmentType ?? "-"} | ${
      job.salaryBands.length ? job.salaryBands.map(formatSalary).join("  ·  ") : formatSalary(job.salary)
    }`,
    job.tags.length ? `tags: ${job.tags.join(", ")}` : "",
    job.url,
    "",
    job.requirements ? `${job.requirements}\n` : "",
    job.tasks ? `${job.tasks}\n` : "",
    job.description ?? "(no description)",
    "",
  ].filter((b) => b !== "")
  process.stdout.write(blocks.join("\n") + "\n")
  return 0
}
