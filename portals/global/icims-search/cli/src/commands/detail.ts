import {
  htmlFetch,
  parseJobPage,
  resolveJobRef,
  stripInvisible,
  writeError,
  type JobDetail,
  type PortalRef,
} from "../helpers.js"

export interface DetailOpts {
  input: string
  portal?: PortalRef
  format: "json" | "plain"
}

/** A human-readable rendering of one posting: header, present fields, description. */
export function renderPlain(job: JobDetail): string {
  const lines = [job.title, `${job.company} · ${job.location || "—"}`]

  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Posted", job.date)
  field("Workplace", job.workplace)
  field("Employment", job.employmentType)
  field("Requisition ID", job.requisitionId)

  lines.push("", job.description || "(no description)", "", `URL: ${job.url}`, `id: ${job.id}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const ref = resolveJobRef(opts.input, opts.portal)
  if (!ref) {
    const hint = /^\d{1,12}$/.test(opts.input.trim())
      ? " - a bare job ID needs --portal <subdomain>"
      : " - expected a https://<portal>.icims.com/jobs/<id>/<slug>/job URL, or an ID with --portal"
    writeError(`Could not resolve an iCIMS posting from "${opts.input}"${hint}`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(ref.url)
    if (html === null) {
      writeError(`No posting ${ref.id} on ${ref.company} (closed, removed, or wrong portal)`, "NOT_FOUND")
      return 1
    }
    const job = parseJobPage(html, ref.url, ref.company)
    if (!job) {
      writeError(
        `No posting ${ref.id} rendered at ${ref.url} (closed, or the portal answered with its error page)`,
        "NOT_FOUND",
      )
      return 1
    }
    const clean = stripInvisible(job)

    if (opts.format === "plain") {
      process.stdout.write(renderPlain(clean) + "\n")
    } else {
      process.stdout.write(JSON.stringify(clean, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
