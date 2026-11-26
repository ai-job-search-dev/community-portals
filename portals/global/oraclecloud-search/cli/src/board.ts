// Oracle Recruiting Cloud (ORC) serves one careers site per employer, each on
// its own Fusion Applications pod host. There is no global index, so every
// command names a board:
//
//   careers page  https://<host>/hcmUI/CandidateExperience/<lang>/sites/<site>/jobs
//   search API    GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions
//   detail API    GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails/<id>
//
// Hosts are pinned to Oracle's pod family. ORC tenants live on
//   <tenant>.fa.oraclecloud.com
//   <tenant>.fa.<region>.oraclecloud.com       (e.g. us2)
//   <tenant>.fa.ocs.oraclecloud.com
// and the same shapes on the numbered apex oraclecloud<NN>.com that newer
// tenants get. The numeric suffix is bounded to 1-99, so this stays an exact
// host pin and never becomes `oraclecloud<anything>.com`.

export interface Board {
  /** Pod hostname, e.g. jpmc.fa.oraclecloud.com */
  host: string
  /** Employer's tenant slug (the host's first label), e.g. jpmc */
  tenant: string
  /** Careers-site language, e.g. en */
  lang: string
  /** ORC site number, usually CX_1 or CX_1001 */
  site: string
  origin: string
  api: string
  /** Prefix for a public posting URL; append /job/<id> */
  jobBase: string
}

const ORACLE_HOST =
  /^[a-z0-9-]+\.fa\.(?:[a-z0-9-]+\.)?oraclecloud(?:[1-9][0-9]?)?\.com$/
const LANG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})?$/
// Site numbers and requisition ids are path segments. No dot or slash, so URL
// normalization cannot drop a segment and point the request somewhere else.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Whether a value is safe as one path segment in an ORC URL. */
export function isSegment(value: string): boolean {
  return SEGMENT.test(value)
}

function makeBoard(host: string, lang: string, site: string): Board {
  const origin = `https://${host}`
  return {
    host,
    tenant: host.split(".")[0],
    lang,
    site,
    origin,
    api: `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`,
    jobBase: `${origin}/hcmUI/CandidateExperience/${lang}/sites/${site}`,
  }
}

/**
 * Parse a board reference into its endpoints, or null.
 *
 * Accepted:
 *   - the employer's careers URL, e.g.
 *     https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs
 *     (with or without a trailing /jobs or /job/<id>)
 *   - <host>/<site>, e.g. jpmc.fa.oraclecloud.com/CX_1001 (language defaults to en)
 *   - <host>/<lang>/<site>, e.g. jpmc.fa.oraclecloud.com/en/CX_1001
 *
 * A bare host is rejected: the site number is employer-specific, and guessing
 * it would search a site that may not exist (or silently fall back to the
 * tenant's default site).
 */
export function parseBoard(input: string): Board | null {
  const raw = input.trim()
  if (!raw) return null

  if (/^https?:\/\//i.test(raw)) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return null
    }
    const host = url.hostname.toLowerCase()
    if (!ORACLE_HOST.test(host)) return null

    const segments = url.pathname.split("/").filter(Boolean)
    // The documented path is /hcmUI/CandidateExperience/<lang>/sites/<site>/...
    // Require those fixed positions; a look-alike path that merely contains the
    // words must not become a board.
    if (segments[0] !== "hcmUI" || segments[1] !== "CandidateExperience" || segments[3] !== "sites") {
      return null
    }
    const lang = segments[2]
    const site = segments[4]
    if (!lang || !LANG.test(lang) || !site || !isSegment(site)) return null
    return makeBoard(host, lang, site)
  }

  const parts = raw.split("/").map((part) => part.trim())
  if (parts.length !== 2 && parts.length !== 3) return null
  const host = parts[0].toLowerCase()
  if (!ORACLE_HOST.test(host)) return null
  const lang = parts.length === 3 ? parts[1] : "en"
  const site = parts[parts.length - 1]
  if (!LANG.test(lang) || !isSegment(site)) return null
  return makeBoard(host, lang, site)
}

export interface JobTarget {
  board: Board
  /** The requisition's ORC Id, e.g. 210675973 */
  requisitionId: string
  /** The canonical public posting URL, rebuilt from the parsed board. */
  url: string
}

/**
 * Parse a public ORC posting URL into the board and requisition id `detail`
 * needs.
 *
 * This is the gate between a stored (untrusted) URL and a network fetch: the
 * host must be an ORC pod host, and the path must be the documented
 * /hcmUI/CandidateExperience/<lang>/sites/<site>/job/<id> shape. The fetched
 * URL is rebuilt from the derived parts, never the caller's string, so a
 * look-alike host or a non-posting page cannot become a fake result.
 */
export function jobTarget(input: string): JobTarget | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null

  const host = url.hostname.toLowerCase()
  if (!ORACLE_HOST.test(host)) return null

  const segments = url.pathname.split("/").filter(Boolean)
  if (segments[0] !== "hcmUI" || segments[1] !== "CandidateExperience" || segments[3] !== "sites") {
    return null
  }
  const lang = segments[2]
  const site = segments[4]
  if (!lang || !LANG.test(lang) || !site || !isSegment(site)) return null

  const posting = segments.slice(5)
  if (posting.length !== 2 || posting[0] !== "job" || !isSegment(posting[1])) return null

  const board = makeBoard(host, lang, site)
  const requisitionId = posting[1]
  return {
    board,
    requisitionId,
    url: `${board.jobBase}/job/${requisitionId}`,
  }
}

/** The requisition id at the end of a posting URL, for table display. */
export function postingTail(url: string): string {
  const parts = url.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? ""
}
