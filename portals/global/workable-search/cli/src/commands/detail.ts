import {
  ACCOUNT_API,
  isShortlink,
  jsonFetch,
  parseJobRef,
  stripInvisible,
  toDetail,
  writeError,
  type ApiJobDetail,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  input: string
  board?: string
  format: "json" | "plain"
}

/** Plain-text rendering of one posting: description, then requirements, then benefits. */
export function renderPlain(d: JobDetail): string {
  const lines: (string | null)[] = [
    d.title,
    `${d.company || "—"} · ${d.location || "—"}`,
    d.department ? `Department: ${d.department}` : null,
    d.employmentType ? `Employment type: ${d.employmentType}` : null,
    d.workplace ? `Workplace: ${d.workplace}` : null,
    d.requisitionId ? `Reference code: ${d.requisitionId}` : null,
    `Job ID: ${d.id}`,
    d.date ? `Posted: ${d.date.slice(0, 10)}` : null,
    "",
    d.description || "(no description)",
    ...(d.requirements ? ["", "Requirements", d.requirements] : []),
    ...(d.benefits ? ["", "Benefits", d.benefits] : []),
    "",
    `URL: ${d.url}`,
  ]
  return lines.filter((l): l is string => l !== null).join("\n") + "\n"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const ref = parseJobRef(opts.input, opts.board)
  if (!ref) {
    const t = opts.input.trim()
    const hint = isShortlink(t) && !opts.board
      ? " - that link names the posting but not the board; pass --board <slug>"
      : /^[A-Za-z0-9]{4,32}$/.test(t) && !opts.board
        ? " - a bare shortcode needs --board <slug>"
        : " - expected an apply.workable.com/<slug>/j/<shortcode> URL, or a shortcode with --board"
    writeError(`Could not resolve a Workable job from "${opts.input}"${hint}`, "BAD_ID")
    return 1
  }
  try {
    const job = await jsonFetch<ApiJobDetail>(`${ACCOUNT_API}/accounts/${ref.board}/jobs/${ref.id}`)
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
