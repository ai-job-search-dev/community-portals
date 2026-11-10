import { LIST_URL, PortalError, htmlFetch, parseDetail, stripInvisible, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const HOST = /^(www\.)?bulldogjob\.pl$/i

/**
 * Accept an offer id ("260906"), a full id slug ("260906-php-developer-gdansk-teamquest")
 * or a bulldogjob.pl offer URL (with or without scheme). A URL on any other host is
 * rejected, so an apply link to another site can never fetch an unrelated offer.
 * Returns the path slug, or null when nothing usable was found.
 */
export function normalizeId(input: string): string | null {
  const t = input.trim()
  if (/^\d{4,}(-[a-z0-9-]+)?$/i.test(t)) return t.toLowerCase()
  const hasScheme = /^https?:\/\//i.test(t)
  if (!hasScheme && !/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(t)) return null
  let u: URL
  try {
    u = new URL(hasScheme ? t : `https://${t}`)
  } catch {
    return null
  }
  if (!HOST.test(u.hostname)) return null
  const m = u.pathname.match(/^\/(?:en\/)?companies\/jobs\/(\d{4,}(?:-[a-z0-9-]+)?)\/?$/i)
  return m ? m[1].toLowerCase() : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = normalizeId(opts.id)
  if (!slug) {
    writeError(`Could not parse a bulldogjob offer id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(`${LIST_URL}/${slug}`)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parseDetail(html, slug))
    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.level ? `Level: ${job.level}` : null,
        job.employmentType ? `Employment: ${job.employmentType}` : null,
        job.contracts.length ? `Contracts: ${job.contracts.join(", ")}` : null,
        job.salary ? `Salary: ${job.salary}` : null,
        job.workModes.length ? `Work mode: ${job.workModes.join(", ")}` : null,
        job.workFrom.length ? `Work from: ${job.workFrom.join(", ")}` : null,
        job.tags.length ? `Tech: ${job.tags.join(", ")}` : null,
        job.date ? `Published: ${job.date}` : null,
        job.deadline ? `Deadline: ${job.deadline}` : null,
        `Status: ${job.isActive ? "ACTIVE" : "CLOSED / EXPIRED"}`,
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ].filter((l): l is string => l !== null)
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof PortalError ? e.code : "DETAIL_FAILED")
    return 1
  }
}
