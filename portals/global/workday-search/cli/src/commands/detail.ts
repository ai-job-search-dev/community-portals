import { jobTarget, type JobTarget } from "../board.js"
import {
  HttpError,
  htmlToText,
  parsePostedOn,
  requestJson,
  stripInvisible,
  toIsoDate,
  writeError,
} from "../helpers.js"

export interface DetailResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  deadline: string | null
  employmentType: string | null
  canApply: boolean | null
  url: string
  description: string | null
}

interface WorkdayDetailResponse {
  jobPostingInfo?: {
    title?: unknown
    jobDescription?: unknown
    location?: unknown
    additionalLocations?: unknown
    postedOn?: unknown
    startDate?: unknown
    endDate?: unknown
    timeType?: unknown
    canApply?: unknown
  }
  hiringOrganization?: { name?: unknown }
}

function joinLocations(primary: unknown, additional: unknown): string | null {
  const places: string[] = []
  if (typeof primary === "string" && primary.trim()) places.push(primary.trim())
  if (Array.isArray(additional)) {
    for (const place of additional) {
      if (typeof place === "string" && place.trim()) places.push(place.trim())
    }
  }
  const unique = [...new Set(places)]
  return unique.length > 0 ? unique.join(" · ") : null
}

/**
 * Map the CXS detail payload to the portal contract's detail shape.
 *
 * The public posting URL is the one derived from the board, never the payload's
 * own `externalUrl`: the caller passed a Workday URL, and echoing it back would
 * make a look-alike or locale variant look canonical.
 */
export function parseDetail(body: WorkdayDetailResponse, target: JobTarget, now = new Date()): DetailResult {
  const info = body.jobPostingInfo
  if (!info || typeof info !== "object") {
    throw new Error("Workday detail response has no jobPostingInfo")
  }
  const title =
    typeof info.title === "string" ? stripInvisible(info.title).trim() : ""
  if (!title) throw new Error("Workday detail response has no job title")

  const organization = body.hiringOrganization?.name
  const company =
    typeof organization === "string" && organization.trim() ? organization.trim() : target.board.tenant

  return stripInvisible({
    id: target.url,
    title,
    company,
    location: joinLocations(info.location, info.additionalLocations),
    date: toIsoDate(info.startDate) ?? parsePostedOn(info.postedOn, now),
    deadline: toIsoDate(info.endDate),
    employmentType: typeof info.timeType === "string" && info.timeType.trim() ? info.timeType.trim() : null,
    canApply: typeof info.canApply === "boolean" ? info.canApply : null,
    url: target.url,
    description: typeof info.jobDescription === "string" ? htmlToText(info.jobDescription) : null,
  })
}

function renderPlain(job: DetailResult): string {
  return [
    `id: ${job.id}`,
    `title: ${job.title}`,
    `company: ${job.company ?? "-"}`,
    `location: ${job.location ?? "-"}`,
    `date: ${job.date ?? "-"}`,
    `deadline: ${job.deadline ?? "-"}`,
    `employmentType: ${job.employmentType ?? "-"}`,
    `canApply: ${job.canApply === null ? "-" : String(job.canApply)}`,
    `url: ${job.url}`,
    "",
    job.description ?? "(no description)",
  ].join("\n")
}

export async function runDetail(id: string, format: "json" | "plain"): Promise<number> {
  const target = jobTarget(id)
  if (!target) {
    writeError(
      `could not parse a Workday job URL from "${id}" - expected something like https://<tenant>.wdN.myworkdayjobs.com/<site>/job/<place>/<title>_<req> (the "id" or "url" from a search result)`,
      "BAD_ID",
    )
    return 1
  }

  let payload: WorkdayDetailResponse
  try {
    payload = await requestJson<WorkdayDetailResponse>(target.board.cxsBase + target.externalPath, {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (compatible; workday-search/1.0; +https://github.com/ai-job-search-dev/community-portals)",
      },
    })
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      writeError(
        `Job not found on ${target.board.jobBase} - the posting may be closed, or the board or site in the URL may be wrong`,
        "NOT_FOUND",
      )
    } else if (e instanceof HttpError && (e.status === 401 || e.status === 403 || e.status === 422)) {
      writeError(
        `${e.message} - the board may be retired or restricted; check ${target.board.jobBase} loads in a browser`,
        "API_ERROR",
      )
    } else {
      writeError(e instanceof Error ? e.message : String(e), "API_ERROR")
    }
    return 1
  }

  let job: DetailResult
  try {
    job = parseDetail(payload, target)
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "PARSE_ERROR")
    return 1
  }

  process.stdout.write(
    format === "plain" ? renderPlain(job) + "\n" : JSON.stringify(job, null, 2) + "\n",
  )
  return 0
}
