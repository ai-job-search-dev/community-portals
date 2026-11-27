import {
  ApiError,
  apiToken,
  fetchDatasetItems,
  normalizeLineBreaks,
  parseDetailId,
  stripInvisible,
  toResult,
  writeError,
  type JobResult,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

function renderPlain(job: JobResult): string {
  const lines: string[] = []
  lines.push(job.title || "(untitled)")
  lines.push(`${job.company || "—"} · ${job.location || "—"}`)
  lines.push("")
  lines.push(`Posted: ${job.date || "—"}`)
  lines.push(`Salary: ${job.salary || "—"}`)
  lines.push(`Work mode: ${job.workMode || "—"}`)
  lines.push(`Job types: ${job.jobTypes.length ? job.jobTypes.join(", ") : "—"}`)
  lines.push("")
  lines.push(job.description ? normalizeLineBreaks(job.description) : "(no description)")
  if (job.apply_options.length) {
    lines.push("")
    lines.push("Apply:")
    for (const option of job.apply_options) {
      lines.push(`  ${option.title || "Apply"}: ${option.link || "—"}`)
    }
  }
  lines.push("")
  lines.push(`id: ${job.id}`)
  return normalizeLineBreaks(lines.join("\n"))
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const parsed = parseDetailId(opts.id)
  if (!parsed) {
    writeError(`Could not parse a detail id from "${opts.id}" (expected <dataset_id>:<offset>)`, "BAD_ID")
    return 1
  }

  const token = apiToken()
  if (!token) {
    writeError(
      "APIFY_API_TOKEN is not set. Create an Apify API token in Console -> Settings -> API & Integrations, then export APIFY_API_TOKEN=...",
      "MISSING_TOKEN",
    )
    return 1
  }

  try {
    const items = await fetchDatasetItems(parsed.datasetId, parsed.offset, 1, token)
    if (items.length === 0) {
      writeError(
        `No record at offset ${parsed.offset} in dataset ${parsed.datasetId}. The dataset may have expired (Apify keeps datasets for a limited time) or the id may be stale.`,
        "NOT_FOUND",
      )
      return 1
    }
    const job = stripInvisible(toResult(items[0], parsed.datasetId, parsed.offset))
    if (opts.format === "plain") {
      process.stdout.write(renderPlain(job) + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    // Apify answers a missing or expired dataset with 404. That is the same
    // outcome as an empty page: the id no longer resolves, so it becomes
    // NOT_FOUND rather than a generic HTTP_ERROR.
    if (e instanceof ApiError && e.status === 404) {
      writeError(
        `Dataset ${parsed.datasetId} was not found (HTTP 404). The dataset may have expired (Apify keeps datasets for a limited time) or the id may be stale.`,
        "NOT_FOUND",
      )
      return 1
    }
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "DETAIL_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
