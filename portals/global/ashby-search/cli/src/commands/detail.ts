import {
  fetchBoard,
  fetchOrgName,
  formatMoney,
  parseJobRef,
  stripInvisible,
  toDetail,
  writeError,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  input: string
  board?: string
  format: "json" | "plain"
}

export function renderPlain(d: JobDetail): string {
  const pay = d.pay
    .filter((p) => p.type === "Salary" || p.type === null)
    .map((p) => `Pay: ${formatMoney(p.min, p.currency)} - ${formatMoney(p.max, p.currency)}${p.interval ? ` (${p.interval.toLowerCase()})` : ""}`)
  // Department and team, either of which may be missing.
  const unit = [d.department, d.team && d.team !== d.department ? d.team : null].filter(Boolean).join(" / ")
  // null = omitted line; "" = intentional blank separator.
  const lines: (string | null)[] = [
    d.title,
    `${d.company || "—"} · ${d.location || "—"}`,
    "",
    d.secondaryLocations.length ? `Also: ${d.secondaryLocations.join("; ")}` : null,
    d.workplace ? `Workplace: ${d.workplace}` : null,
    d.employmentType ? `Employment: ${d.employmentType}` : null,
    unit ? `Department: ${unit}` : null,
    d.date ? `Posted: ${d.date.slice(0, 10)}` : null,
    d.compensation ? `Compensation: ${d.compensation}` : null,
    ...pay,
    `Status: ${d.isActive ? "ACTIVE" : "UNLISTED"}`,
    "",
    d.description || "(no description)",
    "",
    `URL: ${d.url}`,
    d.applyUrl ? `Apply: ${d.applyUrl}` : null,
  ]
  return lines.filter((l): l is string => l !== null).join("\n") + "\n"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const ref = parseJobRef(opts.input, opts.board)
  if (!ref) {
    const t = opts.input.trim()
    const urlRef = opts.board ? parseJobRef(t) : null
    const hint = /^[0-9a-f-]{36}$/i.test(t)
      ? " - a bare job ID needs --board <slug>"
      : urlRef
        ? ` - the URL is on board "${urlRef.board}" but --board is "${opts.board}"`
        : /ashby_jid=/i.test(t)
          ? " - a company careers URL with ?ashby_jid= needs --board <slug> (the slug is not in that URL)"
          : " - expected a jobs.ashbyhq.com/<board>/<id> URL, or an ID with --board"
    writeError(`Could not resolve an Ashby job from "${opts.input}"${hint}`, "BAD_ID")
    return 1
  }
  try {
    const data = await fetchBoard(ref.board)
    if (!data) {
      writeError(`No Ashby job board named "${ref.board}" (HTTP 404)`, "BOARD_NOT_FOUND")
      return 1
    }
    const job = (data.jobs ?? []).find((j) => j.id.toLowerCase() === ref.id)
    if (!job) {
      writeError(`Job ${ref.id} is not on board "${ref.board}" (closed, or wrong board)`, "NOT_FOUND")
      return 1
    }
    const company = await fetchOrgName(ref.board)
    const d = stripInvisible(toDetail(job, ref.board, company))
    process.stdout.write(opts.format === "plain" ? renderPlain(d) : JSON.stringify(d, null, 2) + "\n")
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
