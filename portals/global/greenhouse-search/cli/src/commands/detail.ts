import {
  API_HOSTS,
  formatMoney,
  jsonFetch,
  parseJobRef,
  stripInvisible,
  toDetail,
  writeError,
  type ApiJob,
  type JobDetail,
  type Region,
} from "../helpers.js"

export interface DetailOpts {
  input: string
  board?: string
  region: Region
  format: "json" | "plain"
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim()

/**
 * Plain-text rendering of one posting. Greenhouse usually embeds the pay block
 * (blurb, label and range) inside `content` itself, so a pay note is appended
 * only when the description does not already carry its text.
 */
export function renderPlain(d: JobDetail): string {
  const pay = d.payRanges.map((p) => `Pay: ${formatMoney(p.min, p.currency)} - ${formatMoney(p.max, p.currency)}`)
  const desc = squash(d.description ?? "")
  const payNotes = d.payRanges
    .map((p) => p.note)
    .filter((n): n is string => !!n && !desc.includes(squash(n)))
  // null = omitted line; "" = intentional blank separator.
  const lines: (string | null)[] = [
    d.title,
    `${d.company || "—"} · ${d.location || "—"}`,
    "",
    d.departments.length ? `Department: ${d.departments.join(", ")}` : null,
    d.offices.length ? `Offices: ${d.offices.join("; ")}` : null,
    d.requisitionId ? `Requisition ID: ${d.requisitionId}` : null,
    `Job ID: ${d.id}`,
    d.date ? `Posted: ${d.date}` : null,
    `Deadline: ${d.deadline ?? "none stated"}`,
    ...pay,
    "",
    d.description || "(no description)",
    ...(payNotes.length ? ["", ...payNotes] : []),
    "",
    `URL: ${d.url}`,
  ]
  return lines.filter((l): l is string => l !== null).join("\n") + "\n"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const ref = parseJobRef(opts.input, opts.board, opts.region)
  if (!ref) {
    const hint = /^\d+$/.test(opts.input.trim())
      ? " - a bare job ID needs --board <token>"
      : " - expected a job-boards.greenhouse.io/<board>/jobs/<id> URL, or an ID with --board"
    writeError(`Could not resolve a Greenhouse job from "${opts.input}"${hint}`, "BAD_ID")
    return 1
  }
  try {
    const job = await jsonFetch<ApiJob>(
      `${API_HOSTS[ref.region]}/${ref.board}/jobs/${ref.id}?pay_transparency=true`,
    )
    if (!job) {
      writeError(`Job ${ref.id} not found on board "${ref.board}" (closed, or wrong board)`, "NOT_FOUND")
      return 1
    }
    const d = stripInvisible(toDetail(job, ref.board))

    if (opts.format === "plain") {
      process.stdout.write(renderPlain(d))
    } else {
      process.stdout.write(JSON.stringify(d, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
