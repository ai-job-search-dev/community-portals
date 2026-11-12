import {
  fetchWithBackoff,
  loadWatchlist,
  normalizeAshbyJob,
  normalizeGreenhouseJob,
  normalizeLeverJob,
  writeError,
  type ATSProvider,
  type NormalizedJob,
  type WatchlistEntry,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
  watchlist?: string
}

interface ParsedIdentifier {
  provider: ATSProvider
  slug: string
  jobId: string
  company?: string
}

export function parseIdentifier(raw: string, watchlistCustomPath?: string): ParsedIdentifier | null {
  const trimmed = raw.trim()

  // Case 1: Composite ID format: provider:slug:jobId
  const composite = trimmed.match(/^(greenhouse|lever|ashby):([^:]+):(.+)$/i)
  if (composite) {
    const provider = composite[1].toLowerCase() as ATSProvider
    const slug = composite[2]
    const jobId = composite[3]
    return { provider, slug, jobId }
  }

  // Case 2: Direct Greenhouse URL: https://boards.greenhouse.io/<slug>/jobs/<jobId>
  const gh = trimmed.match(/boards\.greenhouse\.io\/([^\/]+)\/jobs\/(\d+)/i)
  if (gh) {
    return { provider: "greenhouse", slug: gh[1], jobId: gh[2] }
  }

  // Case 3: Direct Lever URL: https://jobs.lever.co/<slug>/<jobId>
  const lv = trimmed.match(/jobs\.lever\.co\/([^\/]+)\/([^\/?#]+)/i)
  if (lv) {
    return { provider: "lever", slug: lv[1], jobId: lv[2] }
  }

  // Case 4: Direct Ashby URL: https://jobs.ashbyhq.com/<slug>/<jobId>
  const ashby = trimmed.match(/jobs\.ashbyhq\.com\/([^\/]+)\/([^\/?#]+)/i)
  if (ashby) {
    return { provider: "ashby", slug: ashby[1], jobId: ashby[2] }
  }

  return null
}

function renderPlain(job: NormalizedJob): string {
  const lines = [
    job.title,
    `${job.site} · ${job.location ?? "—"}`,
    "",
    job.date ? `Posted: ${job.date}` : "",
    job.type ? `Employment: ${job.type}` : "",
    job.salary ? `Salary: ${job.salary}` : "",
    "",
    job.description || "(no description)",
    "",
    `Apply URL: ${job.apply_url}`,
    `ID: ${job.id}`,
  ].filter((l) => l !== "")

  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const target = opts.id.trim()
  if (!target) {
    writeError("detail requires an <id|url>", "NO_ID")
    return 1
  }

  // Safe ids only: a job id becomes a URL path segment, so a value containing "/"
  // or ".." could address a different board than the watchlist slug.
  const SAFE_JOB_ID = /^[A-Za-z0-9._-]{1,128}$/

  let watchlist: WatchlistEntry[]
  try {
    watchlist = loadWatchlist(opts.watchlist)
  } catch (err) {
    writeError(
      `Could not load watchlist: ${err instanceof Error ? err.message : String(err)}`,
      "WATCHLIST_FAILED",
    )
    return 1
  }

  let parsed = parseIdentifier(target, opts.watchlist)

  if (parsed) {
    // Resolve identifier against the watchlist allowlist
    const entry = watchlist.find(
      (w) => w.provider === parsed!.provider && w.slug.toLowerCase() === parsed!.slug.toLowerCase(),
    )
    if (!entry) {
      writeError(`Could not identify ATS provider or company from "${target}"`, "BAD_ID")
      return 1
    }
    parsed.company = entry.company
    parsed.slug = entry.slug
  } else {
    if (!SAFE_JOB_ID.test(target)) {
      writeError(`Invalid job id "${target}": expected letters, digits, dot, underscore or hyphen`, "BAD_ID")
      return 1
    }
    // If bare ID, check watchlist companies to find which board it belongs to.
    // A provider outage would otherwise burn every board's full retry budget in
    // series, so the scan is bounded by a deadline and stops early.
    let lastError: Error | null = null
    const scanDeadline = Date.now() + 20000
    let scanned = 0
    for (const entry of watchlist) {
      if (Date.now() > scanDeadline) break
      scanned++
      try {
        if (entry.provider === "greenhouse" && /^\d+$/.test(target)) {
          const check = await fetchWithBackoff(
            `https://boards-api.greenhouse.io/v1/boards/${entry.slug}/jobs/${target}`,
          )
          if (check && check.id) {
            parsed = { provider: "greenhouse", slug: entry.slug, jobId: target, company: entry.company }
            break
          }
        } else if (entry.provider === "lever") {
          const check = await fetchWithBackoff(
            `https://api.lever.co/v0/postings/${entry.slug}/${target}`,
          )
          if (check && check.id) {
            parsed = { provider: "lever", slug: entry.slug, jobId: target, company: entry.company }
            break
          }
        } else if (entry.provider === "ashby") {
          const board = await fetchWithBackoff(
            `https://api.ashbyhq.com/posting-api/job-board/${entry.slug}?includeCompensation=true`,
          )
          if (board && board.jobs && board.jobs.some((j: any) => j.id === target)) {
            parsed = { provider: "ashby", slug: entry.slug, jobId: target, company: entry.company }
            break
          }
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }

    if (!parsed) {
      const truncated = scanned < watchlist.length ? ` (scan stopped after ${scanned} of ${watchlist.length} boards)` : ""
      const errorMsg = lastError
        ? `Could not identify ATS provider or company from "${target}": ${lastError.message}${truncated}`
        : `Could not identify ATS provider or company from "${target}"${truncated}`
      writeError(errorMsg, "BAD_ID")
      return 1
    }
  }

  if (!SAFE_JOB_ID.test(parsed.jobId)) {
    writeError(`Invalid job id "${parsed.jobId}": expected letters, digits, dot, underscore or hyphen`, "BAD_ID")
    return 1
  }

  try {
    let job: NormalizedJob | null = null
    const company = parsed.company || parsed.slug

    if (parsed.provider === "greenhouse") {
      const data = await fetchWithBackoff(
        `https://boards-api.greenhouse.io/v1/boards/${parsed.slug}/jobs/${parsed.jobId}?questions=true`,
      )
      if (data && data.id) {
        job = normalizeGreenhouseJob(data, parsed.slug, company)
      }
    } else if (parsed.provider === "lever") {
      const data = await fetchWithBackoff(
        `https://api.lever.co/v0/postings/${parsed.slug}/${parsed.jobId}`,
      )
      if (data && data.id) {
        job = normalizeLeverJob(data, parsed.slug, company)
      }
    } else if (parsed.provider === "ashby") {
      const board = await fetchWithBackoff(
        `https://api.ashbyhq.com/posting-api/job-board/${parsed.slug}?includeCompensation=true`,
      )
      if (board && board.jobs) {
        const j = board.jobs.find((item: any) => item.id === parsed!.jobId)
        if (j) {
          job = normalizeAshbyJob(j, parsed.slug, company)
        }
      }
    }

    if (!job) {
      writeError(`Job not found for ID "${target}"`, "NOT_FOUND")
      return 1
    }

    if (opts.format === "plain") {
      process.stdout.write(renderPlain(job) + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
