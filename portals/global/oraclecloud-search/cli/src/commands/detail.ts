import { jobTarget, type JobTarget } from "../board.js"
import {
  HttpError,
  assembleLocation,
  htmlToText,
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
  url: string
  description: string | null
}

interface OracleDetail {
  Title?: unknown
  PrimaryLocation?: unknown
  secondaryLocations?: unknown
  workLocation?: unknown
  WorkplaceTypeCode?: unknown
  ExternalPostedStartDate?: unknown
  ExternalPostedEndDate?: unknown
  JobSchedule?: unknown
  JobType?: unknown
  LegalEmployer?: unknown
  Organization?: unknown
  ExternalDescriptionStr?: unknown
  ExternalResponsibilitiesStr?: unknown
  ExternalQualificationsStr?: unknown
  ShortDescriptionStr?: unknown
}

export type OracleDetailResponse = OracleDetail | { items?: unknown }

/** The detail document, whether the tenant returns it bare or wrapped in items[]. */
function detailRecord(body: OracleDetailResponse): OracleDetail | null {
  if (Array.isArray((body as { items?: unknown[] })?.items)) {
    return ((body as { items: unknown[] }).items[0] as OracleDetail | undefined) ?? null
  }
  return body && typeof body === "object" ? (body as OracleDetail) : null
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue
    // Sanitize before the emptiness test: an all-zero-width value would
    // otherwise win here and then disappear in the final stripInvisible pass.
    const text = stripInvisible(value).trim()
    if (text) return text
  }
  return null
}

/**
 * Combine the three body fields ORC tenants split a posting across. Some
 * employers (JPMorgan Chase) put everything in ExternalDescriptionStr and leave
 * the other two empty; others use one field per section, and dropping them
 * would hide half the ad.
 */
function buildDescription(record: OracleDetail): string | null {
  const sections: string[] = []
  const add = (label: string, raw: unknown) => {
    if (typeof raw !== "string" || !raw.trim()) return
    const text = htmlToText(raw)
    if (!text) return
    sections.push(label ? `${label}\n${text}` : text)
  }
  add("", record.ExternalDescriptionStr)
  add("Responsibilities", record.ExternalResponsibilitiesStr)
  add("Qualifications", record.ExternalQualificationsStr)
  if (sections.length > 0) return sections.join("\n\n")
  return typeof record.ShortDescriptionStr === "string"
    ? htmlToText(record.ShortDescriptionStr)
    : null
}

/**
 * Map the requisition detail payload to the portal contract's detail shape.
 *
 * The public posting URL is the one derived from the board, never the payload's
 * own ExternalURL: the caller passed an ORC URL, and echoing another one back
 * would make a look-alike or stale link look canonical.
 */
export function parseDetail(body: OracleDetailResponse, target: JobTarget): DetailResult {
  const record = detailRecord(body)
  if (!record) throw new Error("Oracle Recruiting Cloud detail response is empty")

  const title = typeof record.Title === "string" ? stripInvisible(record.Title).trim() : ""
  if (!title) throw new Error("Oracle Recruiting Cloud detail response has no job title")

  const company = firstText(record.LegalEmployer, record.Organization) ?? target.board.tenant

  return stripInvisible({
    id: target.url,
    title,
    company,
    location: assembleLocation(record),
    date: toIsoDate(record.ExternalPostedStartDate),
    deadline: toIsoDate(record.ExternalPostedEndDate),
    employmentType: firstText(record.JobSchedule, record.JobType),
    url: target.url,
    description: buildDescription(record),
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
    `url: ${job.url}`,
    "",
    job.description ?? "(no description)",
  ].join("\n")
}

export async function runDetail(id: string, format: "json" | "plain"): Promise<number> {
  const target = jobTarget(id)
  if (!target) {
    writeError(
      `could not parse an Oracle Recruiting Cloud job URL from "${id}" - expected something like https://<host>/hcmUI/CandidateExperience/<lang>/sites/<site>/job/<id> (the "id" or "url" from a search result)`,
      "BAD_ID",
    )
    return 1
  }

  const url =
    `${target.board.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails/` +
    `${encodeURIComponent(target.requisitionId)}?onlyData=true&expand=workLocation,secondaryLocations`

  let payload: OracleDetailResponse
  try {
    payload = await requestJson<OracleDetailResponse>(url, {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (compatible; oraclecloud-cli/1.0; +https://github.com/ai-job-search-dev/community-portals)",
      },
    })
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      writeError(
        `Job not found on ${target.board.jobBase} - the posting may be closed, or the host or site in the URL may be wrong`,
        "NOT_FOUND",
      )
    } else if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      writeError(
        `${e.message} - the tenant may be restricted by a WAF or retired; check ${target.board.jobBase} loads in a browser`,
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
