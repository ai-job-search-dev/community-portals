import {
  fetchJob,
  formatSalary,
  isJobId,
  parseJobRef,
  stripInvisible,
  toDetail,
  writeError,
  type JobDetail,
  type Region,
} from "../helpers.js"

export interface DetailOpts {
  input: string
  board?: string
  region: Region
  format: "json" | "plain"
}

/**
 * Plain-text rendering of one posting. Lever ships the description, its
 * bullet lists and the trailing "additional" copy as separate fields; all
 * three are already joined into `description` by `toDetail`.
 */
export function renderPlain(d: JobDetail): string {
  const unit = [d.department, d.team && d.team !== d.department ? d.team : null].filter(Boolean).join(" / ")
  // null = omitted line; "" = intentional blank separator.
  const lines: (string | null)[] = [
    d.title,
    `${d.company} · ${d.location || "—"}`,
    "",
    d.workplace ? `Workplace: ${d.workplace}` : null,
    unit ? `Department: ${unit}` : null,
    d.employmentType ? `Employment: ${d.employmentType}` : null,
    d.country ? `Country: ${d.country}` : null,
    d.date ? `Posted: ${d.date.slice(0, 10)}` : null,
    d.salary ? `Pay: ${formatSalary(d.salary)}` : null,
    `Job ID: ${d.id}`,
    "",
    d.description || "(no description)",
    "",
    `URL: ${d.url}`,
    d.applyUrl ? `Apply: ${d.applyUrl}` : null,
  ]
  return lines.filter((l): l is string => l !== null).join("\n") + "\n"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const ref = parseJobRef(opts.input, opts.board, opts.region)
  if (!ref) {
    const t = opts.input.trim()
    const urlRef = opts.board ? parseJobRef(t, undefined, opts.region) : null
    const hint = isJobId(t)
      ? " - a bare job ID needs --board <slug>"
      : /^[0-9a-f-]{20,}$/i.test(t)
        ? " - Lever job IDs are UUIDs (8-4-4-4-12 hex digits)"
        : urlRef
          ? ` - the URL is on board "${urlRef.board}" but --board is "${opts.board}"`
          : " - expected a jobs.lever.co/<slug>/<uuid> URL, or an ID with --board"
    writeError(`Could not resolve a Lever job from "${opts.input}"${hint}`, "BAD_ID")
    return 1
  }
  try {
    const job = await fetchJob(ref.board, ref.id, ref.region)
    if (!job) {
      writeError(
        `Job ${ref.id} not found on board "${ref.board}" (closed, unknown board, or wrong board)`,
        "NOT_FOUND",
      )
      return 1
    }
    const d = stripInvisible(toDetail(job, ref.board, ref.region))

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
