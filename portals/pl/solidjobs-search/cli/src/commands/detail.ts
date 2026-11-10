import { OFFER_CODE, SITE_BASE, fetchText, formatSalary, parseJobDetail, stripInvisible, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const SOLID_HOST = /^(www\.)?solid\.jobs$/i

/**
 * Accept a short code (`xaev3a3s`, the `id` from search), a short link
 * (`https://solid.jobs/o/<code>[/...]`) or a full offer URL
 * (`https://solid.jobs/offer/<number>/<slug>`). Returns the page path to fetch
 * and the id to report. URLs on any other host are rejected, with host and path
 * read through real URL parsing so look-alike hosts and userinfo tricks fail.
 */
export function normalizeId(input: string): { id: string; path: string } | null {
  const trimmed = input.trim()
  if (OFFER_CODE.test(trimmed)) return { id: trimmed, path: `/o/${trimmed}` }

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (!hasScheme && !/^(www\.)?solid\.jobs\//i.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (!SOLID_HOST.test(parsed.hostname) || parsed.username || parsed.password) return null
  const short = parsed.pathname.match(/^\/o\/([a-z0-9]+)(?:\/|$)/i)
  if (short) return { id: short[1], path: `/o/${short[1]}` }
  const full = parsed.pathname.match(/^\/offer\/(\d+)\/([a-z0-9-]+)\/?$/i)
  if (full) return { id: full[1], path: `/offer/${full[1]}/${full[2]}` }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const ref = normalizeId(opts.id)
  if (!ref) {
    writeError(`Could not parse a SOLID.Jobs offer id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const url = `${SITE_BASE}${ref.path}`
    const html = await fetchText(url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
    if (!html) {
      writeError("Offer not found", "NOT_FOUND")
      return 1
    }
    const parsed = parseJobDetail(html, ref.id, url)
    if (!parsed) {
      writeError("Offer page carries no JobPosting data (removed offer or markup change)", "NOT_FOUND")
      return 1
    }
    // Employer-controlled text: drop invisible and terminal-control characters
    // before it reaches stdout, in every format.
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}${job.remote ? " · remote" : ""}`,
        "",
        `Salary: ${formatSalary(job.salary)}`,
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.experienceMonths !== null ? `Experience: ${job.experienceMonths} months` : "",
        job.skills.length ? `Skills: ${job.skills.join(", ")}` : "",
        job.date ? `Posted: ${job.date}` : "",
        job.deadline ? `Deadline: ${job.deadline}` : "",
        `Status: ${job.isActive ? "ACTIVE" : "CLOSED / EXPIRED"}`,
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""))
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
