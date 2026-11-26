import {
  DETAIL_PATH,
  apiGet,
  isJob,
  normalizeId,
  stripInvisible,
  toDetail,
  writeError,
  type EditxJobDetail,
  type JobDetailResult,
} from "../helpers.js"

export interface DetailOpts {
  id: string // an Editx job id or an editx.eu posting URL
  format: "json" | "plain"
}

function renderPlain(job: JobDetailResult): string {
  const lines = [job.title, `${job.company ?? "-"} | ${job.location ?? "-"}`]
  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  const list = (values: string[]) => (values.length ? values.join(", ") : null)
  field("Posted", job.date)
  field("Status", job.status)
  field("Open to apply", job.open_to_apply === null ? null : job.open_to_apply ? "yes" : "no")
  field("Remote", job.remote)
  field("Contract", job.contract)
  field("Functions", list(job.functions))
  field("Experience", list(job.experience))
  field("Education", list(job.education))
  field("Languages", list(job.languages))
  field("Skills", list(job.skills))
  if (job.summary) lines.push("", job.summary)
  lines.push("", job.description ?? "(no description)", "", `URL: ${job.url}`)
  field("Apply", job.apply_url ?? "on the Editx posting page")
  lines.push(`id: ${job.id}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`could not read an Editx job id from "${opts.id}" (want a number or an https://editx.eu/en/it-jobs/<id> URL)`, "BAD_ID")
    return 1
  }
  try {
    const body = await apiGet<EditxJobDetail>(`${DETAIL_PATH}${encodeURIComponent(id)}`)
    if (!body) {
      writeError(`Editx job ${id} not found`, "NOT_FOUND")
      return 1
    }
    // The same check search applies per entry: a 200 without a numeric id is
    // not a job, so it fails instead of printing a bogus id and URL.
    if (!isJob(body)) {
      writeError(`unexpected response shape from the editx API for job ${id} (no numeric id)`, "DETAIL_FAILED")
      return 1
    }
    const job = stripInvisible(toDetail(body))
    if (opts.format === "plain") {
      process.stdout.write(renderPlain(job) + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
