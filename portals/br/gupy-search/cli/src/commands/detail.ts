import { decodeHtmlEntities, htmlFetch, htmlToText, stripInvisible, writeError, type JobDetail } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

// Gupy's aggregator API no longer serves a per-job endpoint: the portal links every
// result to the employer's own career page (<tenant>.gupy.io/job/<base64>), and the
// full posting lives there. `detail` therefore takes the `url` field from a search
// result and reads the job data embedded in that page.

/**
 * Only Gupy-hosted job pages over HTTPS: never an arbitrary host, and only the
 * /job/ and /jobs/ paths robots.txt allows (it disallows /companies and /candidates).
 * Checked for the URL passed in and for every redirect hop.
 */
function isGupyJobUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    /^[a-z0-9-]+\.gupy\.io$/i.test(url.hostname) &&
    /^\/jobs?\//.test(url.pathname)
  )
}

function parseJobUrl(input: string): URL | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  return isGupyJobUrl(url) ? url : null
}

/** /job/<base64 of {"jobId":N,...}> or /jobs/<N> → "N". */
function jobIdFromUrl(url: URL): string | null {
  const numeric = url.pathname.match(/\/jobs\/(\d+)/)
  if (numeric) return numeric[1]
  const encoded = url.pathname.match(/\/job\/([A-Za-z0-9+/_=-]+)/)
  if (!encoded) return null
  try {
    const json = Buffer.from(decodeURIComponent(encoded[1]).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
    const id = (JSON.parse(json) as { jobId?: unknown }).jobId
    return typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id)) ? String(id) : null
  } catch {
    return null
  }
}

type Json = Record<string, unknown>

function scriptBodies(html: string, attrPattern: RegExp): string[] {
  const out: string[] = []
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (attrPattern.test(m[1])) out.push(m[2])
  }
  return out
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Depth-first walk yielding every plain object in a JSON tree. */
function* objects(node: unknown): Generator<Json> {
  if (Array.isArray(node)) {
    for (const item of node) yield* objects(item)
  } else if (node && typeof node === "object") {
    yield node as Json
    for (const value of Object.values(node as Json)) yield* objects(value)
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null)

/** Next.js page props: the job object carries `description` and its own id. */
function fromNextData(html: string, jobId: string | null, url: URL): JobDetail | null {
  for (const body of scriptBodies(html, /id=["']__NEXT_DATA__["']/i)) {
    const candidates = [...objects(tryParse(body))].filter((o) => str(o.description) && (str(o.name) || str(o.title)))
    const job =
      candidates.find((o) => jobId !== null && (String(o.id) === jobId || String(o.jobId) === jobId)) ?? candidates[0]
    if (!job) continue
    // relevantExperiences is the page's "additional information" block (benefits and the like).
    const sections = ["description", "responsibilities", "prerequisites", "relevantExperiences", "additionalInformation"]
      .map((k) => str(job[k]))
      .filter((v): v is string => v !== null)
      .map(htmlToText)
    const city = str(job.addressCity) ?? str(job.city)
    const state = str(job.addressState) ?? str(job.state)
    const workplaceType = str(job.workplaceType)
    const careerPage = (job.careerPage ?? {}) as Json
    return {
      id: jobId ?? String(job.id ?? job.jobId ?? ""),
      title: (str(job.name) ?? str(job.title)) as string,
      company: str(job.careerPageName) ?? str(careerPage.name) ?? str(job.companyName),
      location: workplaceType === "remote" ? "Remoto" : [city, state].filter(Boolean).join(", ") || null,
      date: str(job.publishedAt) ?? str(job.publishedDate),
      url: url.toString(),
      description: sections.join("\n\n") || null,
      workplaceType,
      applicationDeadline: str(job.applicationDeadline) ?? str(job.registerEndDate),
      applyUrl: url.toString(),
    }
  }
  return null
}

/** schema.org JobPosting, which career pages embed for search-engine job listings. */
function fromJsonLd(html: string, jobId: string | null, url: URL): JobDetail | null {
  for (const body of scriptBodies(html, /type=["']application\/ld\+json["']/i)) {
    // Gupy HTML-encodes this block ({&quot;@context&quot;:...}); plain JSON parses either way.
    const posting = [...objects(tryParse(body) ?? tryParse(decodeHtmlEntities(body)))].find((o) => o["@type"] === "JobPosting" && str(o.description))
    if (!posting) continue
    const org = posting.hiringOrganization as Json | undefined
    const address = ([...objects(posting.jobLocation)].find((o) => o["@type"] === "PostalAddress") ?? {}) as Json
    const remote = posting.jobLocationType === "TELECOMMUTE"
    return {
      id: jobId ?? "",
      title: str(posting.title) as string,
      company: org ? str(org.name) : null,
      location: remote
        ? "Remoto"
        : [str(address.addressLocality), str(address.addressRegion)].filter(Boolean).join(", ") || null,
      date: str(posting.datePosted),
      url: url.toString(),
      description: htmlToText(posting.description as string) || null,
      workplaceType: remote ? "remote" : null,
      applicationDeadline: str(posting.validThrough),
      applyUrl: url.toString(),
    }
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  if (/^\d+$/.test(opts.id)) {
    writeError(
      "Gupy no longer serves job detail by numeric id. Pass the `url` field from a search result instead.",
      "BAD_ID",
    )
    return 1
  }
  const url = parseJobUrl(opts.id)
  if (!url) {
    writeError(`"${opts.id}" is not an https://<company>.gupy.io job URL. Pass the \`url\` field from a search result.`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(url.toString(), isGupyJobUrl)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const jobId = jobIdFromUrl(url)
    const parsed = fromNextData(html, jobId, url) ?? fromJsonLd(html, jobId, url)
    const detail = parsed ? stripInvisible(parsed) : null
    if (!detail || !detail.title) {
      writeError("Could not find job data on the career page; Gupy may have changed its page layout", "PARSE_FAILED")
      return 1
    }

    if (opts.format === "plain") {
      // Optional lines are added only when present, so the blank spacers stay.
      const extras = [
        detail.workplaceType ? `Workplace type: ${detail.workplaceType}` : null,
        detail.applicationDeadline ? `Deadline: ${detail.applicationDeadline}` : null,
      ].filter((l): l is string => l !== null)
      const lines = [
        detail.title,
        `${detail.company || "—"} · ${detail.location || "—"}`,
        ...(extras.length ? ["", ...extras] : []),
        "",
        detail.description || "(no description)",
        "",
        `URL: ${detail.url}`,
      ]
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
