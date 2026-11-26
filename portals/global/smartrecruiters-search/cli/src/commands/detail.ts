import {
  API_BASE,
  isJobId,
  isPublicPosting,
  jsonFetch,
  parseJobRef,
  stripInvisible,
  toDetail,
  writeError,
  type ApiDetail,
  type Compensation,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  input: string
  board?: string
  format: "json" | "plain"
}

/** "100–200 USD / yearly"; keeps the API's period rather than annualizing. */
export function formatCompensation(c: Compensation): string {
  const amount = c.min !== null && c.max !== null
    ? `${c.min}–${c.max}`
    : c.min !== null
      ? `${c.min}`
      : c.max !== null
        ? `${c.max}`
        : ""
  const money = [amount, c.currency].filter(Boolean).join(" ")
  return [money, c.period ? c.period.toLowerCase() : ""].filter(Boolean).join(" / ") || "—"
}

/** Plain-text rendering of one posting: the ad sections, in reading order. */
export function renderPlain(d: JobDetail): string {
  const lines: (string | null)[] = [
    d.title,
    `${d.company || "—"} · ${d.location || "—"}`,
    d.department ? `Department: ${d.department}` : null,
    d.function && d.function !== d.department ? `Function: ${d.function}` : null,
    d.employmentType ? `Employment type: ${d.employmentType}` : null,
    d.experienceLevel && d.experienceLevel !== d.employmentType ? `Experience level: ${d.experienceLevel}` : null,
    d.requisitionId ? `Reference code: ${d.requisitionId}` : null,
    d.language ? `Language: ${d.language}` : null,
    `Job ID: ${d.id}`,
    d.date ? `Posted: ${d.date.slice(0, 10)}` : null,
    d.deadline ? `Deadline: ${d.deadline.slice(0, 10)}` : null,
    d.compensation ? `Pay: ${formatCompensation(d.compensation)}` : null,
    `Status: ${d.active ? "open" : "closed"}`,
    "",
    d.description || "(no description)",
    ...(d.qualifications ? ["", "Qualifications", d.qualifications] : []),
    ...(d.additionalInformation ? ["", "Additional information", d.additionalInformation] : []),
    ...(d.companyDescription ? ["", "Company description", d.companyDescription] : []),
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
    const urlRef = parseJobRef(t)
    const hint = urlRef && opts.board && urlRef.board !== opts.board
      ? ` - the URL is on board "${urlRef.board}" but --board is "${opts.board}"`
      : isJobId(t) && !opts.board
        ? " - a bare posting ID needs --board <slug>"
        : " - expected a jobs.smartrecruiters.com/<slug>/<id> URL, or an ID with --board"
    writeError(`Could not resolve a SmartRecruiters job from "${opts.input}"${hint}`, "BAD_ID")
    return 1
  }
  try {
    const job = await jsonFetch<ApiDetail>(`${API_BASE}/${ref.board}/postings/${ref.id}`)
    if (!job) {
      writeError(`Job ${ref.id} not found on board "${ref.board}" (removed, unknown board, or wrong board)`, "NOT_FOUND")
      return 1
    }
    if (typeof job !== "object" || Array.isArray(job)) {
      writeError(`Unexpected response for job ${ref.id} - expected a posting object`, "DETAIL_FAILED")
      return 1
    }
    if (!isPublicPosting(job)) {
      writeError(`Job ${ref.id} is not public on board "${ref.board}"`, "NOT_FOUND")
      return 1
    }
    const returnedId = typeof job.id === "string" ? job.id.trim() : ""
    const returnedUuid = typeof job.uuid === "string" ? job.uuid.trim().toLowerCase() : ""
    const matchesRequest = returnedId === ref.id || (returnedUuid !== "" && returnedUuid === ref.id.toLowerCase())
    if (!returnedId || !matchesRequest) {
      writeError(
        `Unexpected response for job ${ref.id} - the posting id is ${returnedId || "missing"}`,
        "DETAIL_FAILED",
      )
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
