import { apiGet, parseJobRef, stripInvisible, toDetail, writeError, type JobDetailResult, type RipplingJobDetail } from "../helpers.js"

export interface DetailOpts {
  ref: string // "<slug>/<id>", a full ats.rippling.com posting URL, or a bare id with `board`
  board?: string
  format: "json" | "plain"
}

/** A human-readable rendering of one posting: header, present fields, description. */
function renderPlain(job: JobDetailResult): string {
  const lines = [job.title, `${job.company || "—"} · ${job.location || "—"}`]

  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Posted", job.date)
  field("Department", job.department)
  field("Employment", job.employment_type)
  field("Salary", job.salary)

  lines.push("", job.description || "(no description)", "", `URL: ${job.url}`, `id: ${job.id}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const ref = parseJobRef(opts.ref, opts.board)
  if (!ref) {
    writeError(
      `could not parse a Rippling posting from "${opts.ref}" — pass the "<slug>/<id>" id from a search result, a https://ats.rippling.com/<slug>/jobs/<id> URL, or a bare id with --board <slug>`,
      "BAD_ID",
    )
    return 1
  }

  try {
    const body = await apiGet<RipplingJobDetail>(
      `/api/v1/board/${encodeURIComponent(ref.slug)}/jobs/${encodeURIComponent(ref.id)}`,
    )
    if (body === null) {
      writeError(`job ${ref.id} not found on the "${ref.slug}" board`, "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(toDetail(body, ref.slug))

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
