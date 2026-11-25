import {
  BASE,
  JOB_PATH,
  categoryLabel,
  clean,
  fetchText,
  htmlToText,
  isoDate,
  parseDataPayload,
  regionLabel,
  str,
  stripInvisible,
  writeError,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  organisationType: string | null
  location: string | null
  canton: string | null
  category: string | null
  careerLevel: string | null
  workload: string | null
  date: string | null
  created: string | null
  listingEnd: string | null
  contactName: string | null
  lead: string | null
  description: string
  applyUrl: string | null
  url: string
}

/**
 * The job path to request for an id or a posting URL, or null when the input
 * is neither. A bare id goes through /jobs/x/x/<id>, which the site answers
 * with a redirect to the canonical path.
 */
export function resolveDetail(input: string): string | null {
  const s = input.trim()
  if (/^\d+$/.test(s)) return `/jobs/x/x/${s}`
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null
  if (u.hostname !== "publicjobs.ch" && u.hostname !== "www.publicjobs.ch") return null
  const m = u.pathname.replace(/\/__data\.json$/, "").match(JOB_PATH)
  return m ? `/jobs/${m[1]}/${m[2]}/${m[3]}${m[4] ? `-${m[4]}` : ""}` : null
}

const dataUrl = (path: string) => `${BASE}${path.replace(/\/$/, "")}/__data.json?x-sveltekit-invalidated=01`

function workload(from: unknown, to: unknown): string | null {
  const a = typeof from === "number" && from > 0 ? from : null
  const b = typeof to === "number" && to > 0 ? to : null
  if (a === null && b === null) return null
  if (a === null || b === null || a === b) return `${a ?? b} %`
  return `${a}–${b} %`
}

/** The job record of a decoded detail payload, or null when the payload holds none (expired, removed). */
export function parseJobDetail(body: string): JobDetail | null | { redirect: string } {
  const payload = parseDataPayload(body)
  if (payload.type === "redirect") return { redirect: payload.location }
  if (payload.type !== "data") return null
  const node = payload.nodes.find((n) => n.type === "data" && n.value.job && typeof n.value.job === "object")
  if (!node || node.type !== "data") return null
  const j = node.value.job as Record<string, unknown>
  const path = str(j.pathDe) ?? ""
  const m = `/jobs${path}`.match(JOB_PATH)
  const id = String(j.dynPgID ?? m?.[3] ?? "")
  if (!id) return null
  const region = m ? regionLabel(m[1]) : null
  const city = str(j.workingAddressCity)
  const code = str(j.workingAddressRegion) ?? region?.code ?? null
  const contact = [str(j.contactFirstName), str(j.contactLastName)].filter(Boolean).join(" ")
  return {
    id,
    title: clean(str(j.title)) || `Posting ${id}`,
    company: clean(str(j.contactCompany)) || null,
    organisationType: str(j.contactCategory),
    location: city ? (code ? `${city} (${code})` : city) : (region?.name ?? null),
    canton: code,
    category: str(j.jobCategory) ?? (m ? categoryLabel(m[2]) : null),
    careerLevel: str(j.careerLevel),
    workload: workload(j.workloadFrom, j.workloadTo),
    date: isoDate(j.publicFrom),
    created: isoDate(j.createdAt),
    listingEnd: isoDate(j.publicTo),
    contactName: contact || null,
    lead: clean(str(j.lead)) || null,
    description: htmlToText(str(j.descriptionSimpleHtml) ?? str(j.description)),
    applyUrl: str(j.applicationLink) ?? str(j.redirectUrl),
    url: m ? `${BASE}/jobs${path}` : `${BASE}/jobs/x/x/${id}`,
  }
}

async function fetchDetail(path: string): Promise<JobDetail | null> {
  let body = await fetchText(dataUrl(path))
  if (!body) return null
  let parsed = parseJobDetail(body)
  if (parsed && "redirect" in parsed) {
    // Follow exactly one redirect, and only to another job path on the same site.
    const loc = parsed.redirect.split(/[?#]/)[0]
    if (!JOB_PATH.test(loc)) return null
    body = await fetchText(dataUrl(loc))
    if (!body) return null
    parsed = parseJobDetail(body)
    if (parsed && "redirect" in parsed) return null
  }
  return parsed
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const path = resolveDetail(opts.id)
  if (!path) {
    writeError(
      `Could not resolve "${opts.id}" to a posting: pass a numeric id as search prints it (e.g. 168023) or a posting URL on publicjobs.ch`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const raw = await fetchDetail(path)
    if (!raw) {
      writeError("Job not found (expired, removed, or no posting at that address)", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(raw)
    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.date ? `Published: ${job.date}` : "",
        job.listingEnd ? `Listed until: ${job.listingEnd} (ad end, not the application deadline)` : "",
        job.workload ? `Workload: ${job.workload}` : "",
        job.careerLevel ? `Level: ${job.careerLevel}` : "",
        job.contactName ? `Contact: ${job.contactName}` : "",
        "",
        job.lead || "",
        "",
        job.description || "(no description)",
        "",
        job.applyUrl ? `Apply: ${job.applyUrl}` : "",
        `URL: ${job.url}`,
      ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""))
      process.stdout.write(lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
