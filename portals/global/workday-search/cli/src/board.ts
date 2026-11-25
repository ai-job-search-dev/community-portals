// Workday hosts one board per employer, each on its own tenant host. There is
// no global index, so every command is scoped to a board the caller names:
// either the employer's careers URL or the `tenant/instance/site` triple.
//
//   careers page   https://<tenant>.<instance>.myworkdayjobs.com[/<locale>]/<site>
//   CXS list API   POST https://<tenant>.<instance>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs
//   CXS detail API GET  .../wday/cxs/<tenant>/<site><externalPath>
//
// A second product, myworkdaysite.com, keeps the tenant in the path:
//   https://<instance>.myworkdaysite.com/recruiting/<tenant>/<site>
//
// Both forms are supported. The returned `jobBase` is where the public posting
// lives, so a search result's URL resolves in a browser.

export type BoardHost = "myworkdayjobs" | "myworkdaysite"

export interface Board {
  tenant: string
  site: string
  origin: string
  /** POST target for a search. */
  api: string
  /** Prefix for a detail GET; append the posting's externalPath. */
  cxsBase: string
  /** Prefix for a public posting URL; append the posting's externalPath. */
  jobBase: string
}

const HOST_JOBS = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/
const HOST_SITE = /^(wd\d+)\.myworkdaysite\.com$/
const TENANT = /^[a-z0-9][a-z0-9_-]*$/
// The triple form becomes a hostname label, so it must not carry an underscore.
const HOST_TENANT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const INSTANCE = /^wd\d+$/
// `.` and `..` pass the character class but URL normalization then removes the
// segment, silently changing which board the API path names.
const SITE = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/
const LOCALE = /^[a-z]{2}-[A-Z]{2}$/

function makeBoard(tenant: string, instance: string, site: string, host: BoardHost): Board {
  const origin =
    host === "myworkdayjobs"
      ? `https://${tenant}.${instance}.myworkdayjobs.com`
      : `https://${instance}.myworkdaysite.com`
  const cxsBase = `${origin}/wday/cxs/${tenant}/${site}`
  return {
    tenant,
    site,
    origin,
    api: `${cxsBase}/jobs`,
    cxsBase,
    jobBase:
      host === "myworkdayjobs"
        ? `${origin}/${site}`
        : `${origin}/recruiting/${tenant}/${site}`,
  }
}

/**
 * Parse a board reference into its endpoints, or null.
 *
 * Accepted: a careers-page URL (either Workday product, optional locale
 * segment) or `tenant/instance/site`. A bare tenant is deliberately rejected:
 * guessing the instance (wd1? wd5? wd103?) and the site name produces a
 * confident-looking search of a board that does not exist.
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
    const segments = url.pathname.split("/").filter(Boolean)

    const jobs = HOST_JOBS.exec(url.hostname.toLowerCase())
    if (jobs) {
      if (segments[0] && LOCALE.test(segments[0])) segments.shift()
      // A CXS endpoint passed by mistake must not be read as site "wday": that
      // silently searches a nonexistent board. Honor it as the board it names.
      if (segments[0] === "wday") {
        if (segments[1] !== "cxs" || segments.length < 4) return null
        const cxsTenant = segments[2].toLowerCase()
        const site = segments[3]
        if (cxsTenant !== jobs[1] || !SITE.test(site)) return null
        return makeBoard(jobs[1], jobs[2], site, "myworkdayjobs")
      }
      const site = segments[0] ?? ""
      if (!SITE.test(site)) return null
      return makeBoard(jobs[1], jobs[2], site, "myworkdayjobs")
    }

    const hosted = HOST_SITE.exec(url.hostname.toLowerCase())
    if (hosted) {
      // myworkdaysite URLs may carry a locale before /recruiting/ too,
      // e.g. https://wd3.myworkdaysite.com/en-US/recruiting/mdlz/External.
      if (segments[0] && LOCALE.test(segments[0])) segments.shift()
      if (segments[0] === "wday") {
        if (segments[1] !== "cxs" || segments.length < 4) return null
        const tenant = segments[2].toLowerCase()
        const site = segments[3]
        if (!TENANT.test(tenant) || !SITE.test(site)) return null
        return makeBoard(tenant, hosted[1], site, "myworkdaysite")
      }
      if (segments[0] !== "recruiting" || segments.length < 3) return null
      const tenant = segments[1].toLowerCase()
      const site = segments[2]
      if (!TENANT.test(tenant) || !SITE.test(site)) return null
      return makeBoard(tenant, hosted[1], site, "myworkdaysite")
    }

    return null
  }

  const parts = raw.split("/").map((part) => part.trim())
  if (parts.length !== 3) return null
  const tenant = parts[0].toLowerCase()
  const instance = parts[1].toLowerCase()
  const site = parts[2]
  if (!HOST_TENANT.test(tenant) || !INSTANCE.test(instance) || !SITE.test(site)) return null
  return makeBoard(tenant, instance, site, "myworkdayjobs")
}

export interface JobTarget {
  board: Board
  /** The posting's path inside the site, e.g. /job/Austin-TX/Engineer_R123. */
  externalPath: string
  /** The public posting URL, rebuilt from the parsed board. */
  url: string
}

/**
 * Parse a Workday posting URL into the board and posting path `detail` needs.
 *
 * This is the gate between a stored (untrusted) URL and a network fetch: the
 * host must be a Workday tenant host, and the path must reach a `/job/...`
 * posting. The URL fetched is then rebuilt from the derived parts, never the
 * caller's string, so a look-alike host or a non-posting page cannot become a
 * well-formed fake result.
 */
export function jobTarget(input: string): JobTarget | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null

  const segments = url.pathname.split("/").filter(Boolean)
  const host = url.hostname.toLowerCase()

  const jobs = HOST_JOBS.exec(host)
  if (jobs) {
    if (segments[0] && LOCALE.test(segments[0])) segments.shift()
    const site = segments.shift() ?? ""
    if (!SITE.test(site)) return null
    // Workday's posting path is /job/<place>/<title>_<req>. A bare /job/ (or
    // /job/<place>) is not a posting and must not reach the detail fetch.
    if (segments.length < 3 || segments[0] !== "job") return null
    const externalPath = `/${segments.join("/")}`
    const board = makeBoard(jobs[1], jobs[2], site, "myworkdayjobs")
    return { board, externalPath, url: board.jobBase + externalPath }
  }

  const hosted = HOST_SITE.exec(host)
  if (hosted) {
    if (segments[0] && LOCALE.test(segments[0])) segments.shift()
    if (segments[0] !== "recruiting" || segments.length < 6) return null
    const tenant = segments[1].toLowerCase()
    const site = segments[2]
    if (!TENANT.test(tenant) || !SITE.test(site)) return null
    const posting = segments.slice(3)
    if (posting.length < 3 || posting[0] !== "job") return null
    const externalPath = `/${posting.join("/")}`
    const board = makeBoard(tenant, hosted[1], site, "myworkdaysite")
    return { board, externalPath, url: board.jobBase + externalPath }
  }

  return null
}

/** The requisition-looking tail of an externalPath, for table display. */
export function postingTail(externalPath: string): string {
  const parts = externalPath.split("/").filter(Boolean)
  const last = parts[parts.length - 1] ?? ""
  const underscore = last.indexOf("_")
  return underscore === -1 ? last : last.slice(underscore + 1) || last
}
