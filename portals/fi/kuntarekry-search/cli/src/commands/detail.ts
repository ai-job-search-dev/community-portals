import {
  BASE_URL, CLIError, decodeEntities, finnishDate, helsinkiClock, helsinkiToday, htmlToText, inlineText, kuntarekryGet,
  normalizeJobRef, stripInvisible, visibleHtml, type Format,
} from "../helpers.js"

export interface JobDetail {
  id: string
  title: string
  company: string | null
  unit: string | null
  location: string | null
  region: string | null
  date: string | null
  deadline: string | null
  deadlineTime: string | null
  isActive: boolean | null
  employmentType: string | null
  contractType: string | null
  start: string | null
  salary: string | null
  jobKey: string | null
  description: string | null
  applyUrl: string | null
  url: string
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))
  return m ? decodeEntities(m[1] ?? m[2] ?? "").trim() || null : null
}

/** The page's schema.org JobPosting, if it carries one. */
function jobPosting(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1])
      if (data && typeof data === "object" && data["@type"] === "JobPosting") return data as Record<string, unknown>
    } catch {
      // A malformed block is skipped; the visible page is parsed below anyway.
    }
  }
  return null
}

/** `<ip-details title="...">...</ip-details>` sections, in page order. */
function sections(html: string): Array<{ title: string; body: string }> {
  const out: Array<{ title: string; body: string }> = []
  for (const m of html.matchAll(/<ip-details\b([^>]*)>([\s\S]*?)<\/ip-details>/gi)) {
    out.push({ title: attr(m[1], "title") ?? "", body: m[2] })
  }
  return out
}

/** The "Työpaikan tiedot" aside: label -> lines of its value (the employer is "City\nUnit"). */
function facts(body: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const m of body.matchAll(/<ip-aside-item\b([^>]*)>([\s\S]*?)<\/ip-aside-item>/gi)) {
    const label = attr(m[1], "title")
    const lines = htmlToText(m[2]).split("\n").map((l) => l.trim()).filter(Boolean)
    if (label && lines.length) out[label] = lines
  }
  return out
}

function text(value: unknown): string | null {
  return typeof value === "string" ? inlineText(value) : null
}

/** "11:21" or "11.21" -> "11:21"; anything else is null. */
function clock(value: string | null | undefined): string | null {
  const m = value?.trim().match(/^(\d{1,2})[:.](\d{2})$/)
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : null
}

/**
 * A JSON-LD date or timestamp as a Finnish calendar date and clock time. A
 * timestamp with an offset or Z is an instant and is converted to
 * Europe/Helsinki ("2027-01-06T21:59:00Z" -> 2027-01-06, 23:59); one without
 * an offset is taken as written, as Finnish local time.
 */
function ldTimestamp(value: unknown): { date: string | null; time: string | null } {
  const none = { date: null, time: null }
  const raw = typeof value === "string" ? value.trim() : ""
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/i)
  const written = m ? finnishDate(`${m[3]}.${m[2]}.${m[1]}`) : null
  if (!m || !written) return none
  if (!m[4]) return { date: written, time: null }
  // A malformed time ("23:59:99", "24:00") makes the whole value unusable, so the page fallbacks apply.
  const time = clock(m[4])
  if (!time || (m[5] !== undefined && Number(m[5]) > 59)) return none
  if (!m[6]) return { date: written, time }
  const instant = Date.parse(raw)
  return Number.isFinite(instant) ? { date: helsinkiToday(instant), time: helsinkiClock(instant) } : none
}

/** schema.org baseSalary: `value` may be text, a number or a QuantitativeValue. */
function salaryText(base: unknown): string | null {
  if (!base || typeof base !== "object") return null
  const b = base as Record<string, unknown>
  const currency = typeof b.currency === "string" && b.currency.trim() ? ` ${b.currency.trim()}` : ""
  const num = (x: unknown): string | null => (typeof x === "number" && Number.isFinite(x) ? String(x) : text(x))
  const v = b.value
  if (typeof v === "string") return text(v)
  if (typeof v === "number") return Number.isFinite(v) ? `${v}${currency}` : null
  if (!v || typeof v !== "object") return null
  const q = v as Record<string, unknown>
  const amount = num(q.value) ?? ([num(q.minValue), num(q.maxValue)].filter(Boolean).join("-") || null)
  if (!amount) return null
  const unit = text(q.unitText)
  return `${amount}${currency}${unit ? ` / ${unit.toLowerCase()}` : ""}`
}

export function parseDetail(html: string, slug: string, now = Date.now()): JobDetail {
  // JSON-LD is read from the raw page (it lives in a <script>); everything a
  // reader sees is read from the page with hidden markup already removed.
  const ld = jobPosting(html) ?? {}
  const visible = visibleHtml(html)
  const view = visible.match(/<job-view\b[^>]*>/i)?.[0] ?? ""
  // Carries the posting's publication-date/-time and publication-end/-end-time attributes.
  const button = visible.match(/<favorites-job-button\b[^>]*>/i)?.[0] ?? ""
  const all = sections(visible)
  // The CLI always reads the Finnish page (/fi/tyopaikat/), whose labels are
  // Finnish whatever language the posting is written in (checked on Swedish
  // and English postings, 25.11.2026), so only the Finnish labels are read.
  const factSection = all.find((s) => s.title === "Työpaikan tiedot")
  const info = factSection ? facts(factSection.body) : {}
  const one = (label: string): string | null => info[label]?.join(" ") ?? null

  const title = attr(view, "job-title") ?? text(ld.title)
  if (!title) throw new CLIError("Kuntarekry returned a page without a job title", "BAD_RESPONSE")

  // "Työnantaja" holds the employer on its first line and the unit below it.
  const org = ld.hiringOrganization
  const ldCompany = typeof org === "string" ? text(org) : org && typeof org === "object" ? text((org as Record<string, unknown>).name) : null
  const employerLines = info["Työnantaja"] ?? []
  const company = employerLines[0] ?? ldCompany
  // The unit line often repeats the employer ("Suomen Kuntaliitto, Asiakkuudet ..."); drop that prefix.
  const unitRaw = employerLines.slice(1).join(", ")
  const unit = (company && unitRaw.startsWith(`${company}, `) ? unitRaw.slice(company.length + 2) : unitRaw) || null

  // jobLocation is one Place, or an array of them for a posting with several sites.
  const places = (Array.isArray(ld.jobLocation) ? ld.jobLocation : [ld.jobLocation])
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>).address : null))
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
  const joined = (key: string) => [...new Set(places.map((a) => text(a[key])).filter((v): v is string => !!v))].join(", ") || null
  const location = joined("addressLocality")
  const region = joined("addressRegion")

  // Posted: JSON-LD datePosted, else the page's publication-date. The start of
  // the application period ("Hakuaika") is not used: it need not be the posting date.
  const posted = ldTimestamp(ld.datePosted).date ?? finnishDate(attr(button, "publication-date"))

  // Deadline: "Hakuaika" ("23.11.2026 klo 11:21 - 6.1.2027 klo 23:59"), else
  // the page's publication-end, else JSON-LD validThrough.
  const period = one("Hakuaika")?.match(/^(\d{1,2}\.\d{1,2}\.\d{4})(?:\s+klo\s+[\d:.]+)?\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})(?:\s+klo\s+([\d:.]+))?/)
  const validThrough = ldTimestamp(ld.validThrough)
  const deadline = finnishDate(period?.[2]) ?? finnishDate(attr(button, "publication-end")) ?? validThrough.date
  const deadlineTime = clock(period?.[3]) ?? clock(attr(button, "publication-end-time")) ?? validThrough.time
  // Open until the deadline's time on its day (end of day when no time is given), in Finnish time.
  const today = helsinkiToday(now)
  const isActive = deadline ? deadline > today || (deadline === today && (deadlineTime ?? "23:59") >= helsinkiClock(now)) : null

  const salary = one("Palkka") ?? salaryText(ld.baseSalary)

  // The posting itself: the lead paragraph plus every titled section except the fact table.
  const lead = visible.match(/<p class="lead"[^>]*>([\s\S]*?)<\/p>/i)?.[1]
  const parts = [lead ? htmlToText(lead) : ""]
  for (const s of all) {
    if (s === factSection) continue
    const body = htmlToText(s.body)
    if (body) parts.push(s.title ? `${s.title}\n${body}` : body)
  }
  const description = parts.filter(Boolean).join("\n\n") || null

  const applyTag = visible.match(/<a\b[^>]*class="[^"]*\bapply-button\b[^"]*"[^>]*>/i)?.[0]
  const applyHref = applyTag ? attr(applyTag, "href") : null
  let applyUrl: string | null = null
  if (applyHref) {
    try {
      const u = new URL(applyHref, BASE_URL)
      if (u.protocol === "https:" || u.protocol === "http:") applyUrl = u.href
    } catch {
      applyUrl = null
    }
  }

  return stripInvisible({
    id: slug,
    title,
    company,
    unit,
    location,
    region,
    date: posted,
    deadline,
    deadlineTime,
    isActive,
    employmentType: one("Tyyppi"),
    contractType: one("Työsuhteen tyyppi"),
    start: one("Työn alkamispäivä/ajankohta"),
    salary,
    jobKey: one("Työavain") ?? attr(view, "job-ext-id"),
    description,
    applyUrl,
    url: `${BASE_URL}/fi/tyopaikat/${slug}/`,
  })
}

export async function detail(input: string, get: (path: string) => Promise<string | null> = (p) => kuntarekryGet(p, "html")) {
  const slug = normalizeJobRef(input)
  if (!slug) throw new CLIError("Expected a Kuntarekry job id (the URL slug) or a kuntarekry.fi/fi/tyopaikat/<slug>/ URL", "BAD_ID")
  const html = await get(`/fi/tyopaikat/${slug}/`)
  if (html === null) throw new CLIError("Job not found (it may have closed)", "NOT_FOUND")
  return parseDetail(html, slug)
}

export async function runDetail(input: string, format: Format): Promise<void> {
  const job = await detail(input)
  const out = format === "json" ? JSON.stringify(job, null, 2) : [
    job.title,
    `${job.company ?? "—"}${job.unit ? ` (${job.unit})` : ""} · ${job.location ?? "—"}${job.region && job.region !== job.location ? `, ${job.region}` : ""}`,
    `Posted: ${job.date ?? "unknown"} · Apply by: ${job.deadline ?? "unknown"}${job.deadlineTime ? ` ${job.deadlineTime}` : ""}${job.isActive === false ? " (closed)" : ""}`,
    `Type: ${[job.employmentType, job.contractType].filter(Boolean).join(", ") || "unknown"} · Start: ${job.start ?? "unknown"}`,
    `Salary: ${job.salary ?? "unknown"} · Job key: ${job.jobKey ?? "unknown"}`,
    "",
    job.description ?? "(no description)",
    "",
    `URL: ${job.url}`,
    // Email-only postings have no apply link; never present the posting URL as one.
    `Apply: ${job.applyUrl ?? "no apply link (see the posting for how to apply)"}`,
  ].join("\n")
  process.stdout.write(out + "\n")
}
