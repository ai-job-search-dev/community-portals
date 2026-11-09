// Data source: Djinni's public job board (https://djinni.co/jobs/). No authentication
// required. The search page is server-rendered HTML with one card per posting
// (<div id="job-item-<id>">) plus a JSON-LD array of schema.org JobPosting objects,
// which carries what the cards leave out (posting date, employment type, category).
// A detail page carries one JobPosting JSON-LD block and the rendered description.
// Both are parsed with regex: the markup is shallow and a DOM library is unnecessary.

export const BASE_URL = "https://djinni.co"
export const SEARCH_URL = `${BASE_URL}/jobs/`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; djinni-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        // Djinni renders its labels in Ukrainian for anonymous visitors; asking
        // for it explicitly keeps the parsed labels stable.
        "Accept-Language": "uk,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  /**
   * true when Djinni marks the posting remote-only (JSON-LD jobLocationType
   * TELECOMMUTE). false covers office and hybrid roles, and also roles that
   * offer remote as one option among several: `--employment remote` returns
   * those too, so check `detail`'s `workplace` before ruling one out.
   */
  remoteOnly: boolean | null
  /** Office cities (or countries, where no city is given) from the posting's JSON-LD. */
  offices: string[]
  employmentType: string | null
  experienceYears: number | null
  /** Required English level, e.g. "B1". */
  english: string | null
  /** Public salary as shown, e.g. "до $6000" ("up to $6000"). null when the salary is private. */
  salary: string | null
  /** Djinni's relative pay level for private salaries, "$" (below average) to "$$$$" (top). */
  salaryTier: string | null
  category: string | null
}

export interface JobDetail extends JobCard {
  /** The sidebar's work-format label as shown, e.g. "Тільки віддалено" or "Офіс, Віддалена робота, Гібридний формат роботи". */
  workplace: string | null
  /** Every language requirement as shown, e.g. ["Англійська B1 – Середній", "Українська Носій мови"]. */
  languages: string[]
  validThrough: string | null
  description: string | null
}

/**
 * Djinni's category names ("primary keywords"), as listed in the channel of its
 * public RSS feed on 2026-10-30. The search page silently ignores a name it does
 * not know and returns every posting on the board, so the CLI only sends a name
 * from this list. A category Djinni adds later is rejected until it is added
 * here: failing closed beats an unfiltered result that looks filtered.
 */
export const CATEGORIES = [
  "2D Animation", "2D Artist", "3D Animation", "3D Artist", "Accountant", "Account Manager",
  "Advertising", "Affiliate Manager", "Android", "Angular", "Architect", "Artist",
  "ASIC / Chip Design", "ASP.NET", "Avionics", "Blazor", "Business Analyst",
  "Business Development", "C++", "CAD Designer", "CBDO", "CCO", "CEO", "CFO", "CIO", "C Lang",
  "CMO", "Content Design", "Content Manager", "Content Marketing", "Content Writing", "COO",
  "CPO", "CPP", "Creative and Gaming", "CSO", "CTO", "Data Analyst", "Data Analytics",
  "Data Engineer", "Data Science", "DefTech", "Delivery Manager", "Design", "Development",
  "DevOps", "Digital Marketing", "Digital Marketing Manager", "Dotnet Cloud", "Dotnet Desktop",
  "Dotnet Mobile", "Dotnet Web", "Drupal", "Electrical Engineering", "Electronics / PCB Design",
  "Electronic Warfare", "Elixir", "Embedded", "Engineering / CAD Design", "Engineering Manager",
  "ERP", "Finance Manager", "Finances", "Financial Analyst", "FinOps", "Firmware Engineer",
  "Flutter", "FPGA Engineer", "Fullstack", "Game Design", "Game Developer", "Golang",
  "Graphic Design", "Hardware", "Hardware Engineer", "Hardware & Engineering", "Head Chief", "HR",
  "Illustrator", "Industrial Design", "Information Security", "Interviewer", "iOS", "Java",
  "JavaScript", "Kotlin", "Laravel", "Lead", "Leadership", "Lead Generation", "Level Design",
  "Magento", "Management", "Marketing", "Marketing Analyst", "Marketing and Sales", "Markup",
  "MAUI", "Mechanical Engineering", "Media Buying", "Military Software / C4ISR", "ML AI",
  "Motion Design", "MS Dynamics", ".NET", ".NET Gamedev", "No Code", "Node.js", "Odoo",
  "Operations", "Other", "other_group", "Other non-tech", "Other tech", "Penetration Tester",
  "Performance Marketing", "PHP", "PPC", "PR Manager", "Product Design", "Product Manager",
  "Product Owner", "Project Manager", "Python", "QA", "QA Automation", "QA Hardware / Embedded",
  "Quality Assurance", "React.js", "React Native", "Recruiter", "RF Engineer", "Robotics Engineer",
  "Ruby", "Rust", "Sales", "Salesforce", "Sales Leadership", "Sales Manager", "SAP", "Scala",
  "Scrum Master", "Security", "Security Analyst", "SEO", "Social Media", "SQL", "Support",
  "Svelte", "Symfony", "Sysadmin", "Talent Acquisition", "Technical Writing",
  "UAV / Drone Engineer", "UAV / Drone Pilot", "UI UX", "Unity", "Unity Developer",
  "Unreal Developer", "UX Research", "VFX Artist", "Video Editor", "Vue.js", "Weapons Systems",
  "Web Analyst", "WinForms", "WordPress", "WPF", "Xamarin", "Yii",
]

/** Case-insensitive match against CATEGORIES, returning Djinni's own spelling. */
export function normalizeCategory(input: string): string | null {
  const wanted = input.trim().toLowerCase()
  return CATEGORIES.find((c) => c.toLowerCase() === wanted) ?? null
}

/** Categories whose letters contain the input's, for an unknown-category error ("React" -> "React.js"). */
export function suggestCategories(input: string): string[] {
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "")
  const wanted = squash(input)
  if (!wanted) return []
  return CATEGORIES.filter((c) => squash(c).includes(wanted)).slice(0, 8)
}

/**
 * City slugs from the search form's location filter (2026-10-30). Validated
 * client-side for the same reason as CATEGORIES: a dropped filter must never
 * pass for an applied one.
 */
export const CITIES = [
  "kyiv", "vinnytsia", "dnipro", "ivano-frankivsk", "zhytomyr", "zaporizhzhia", "lviv",
  "mykolaiv", "odesa", "kropyvnytskyi", "lutsk", "poltava", "rivne", "sumy", "ternopil",
  "kherson", "kharkiv", "khmelnytskyi", "cherkasy", "chernihiv", "chernivtsi", "uzhhorod",
]

/** --employment values, sent as-is in the `employment` parameter. */
export const EMPLOYMENT = new Set(["remote", "parttime", "office"])

/** --search-type values -> Djinni's `search_type` parameter. */
export const SEARCH_TYPES: Record<string, string> = {
  basic: "basic-search",
  "full-text": "full-text",
  fulltext: "full-text",
  title: "title-only",
}

/** --region values -> Djinni's `region` parameter (the countries a posting accepts candidates from). */
export function normalizeRegion(input: string): string | null {
  const regions: Record<string, string> = {
    worldwide: "worldwide",
    ukraine: "UKR",
    ukr: "UKR",
    eu: "eu",
    europe: "eu",
    other: "other",
  }
  const key = input.trim().toLowerCase()
  return Object.hasOwn(regions, key) ? regions[key] : null
}

/**
 * Extract the inner HTML of a <div> identified by a CSS class name, correctly
 * handling nested <div> elements by tracking tag depth. Whole tags are matched,
 * so a `</div>` inside a quoted attribute value does not end the element.
 */
export function extractDivContent(html: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const openRe = new RegExp(`<div[^>]*class="[^"]*${escaped}[^"]*"[^>]*>`, "i")
  const open = openRe.exec(html)
  if (!open) return null

  const start = open.index + open[0].length
  // Every tag is matched in order, not just divs: searching for the next `</div`
  // alone would find one inside another tag's attribute value.
  const tags = new RegExp(`<(/?)([a-zA-Z][a-zA-Z0-9-]*)${ATTRS}${TAG_END}`, "g")
  tags.lastIndex = start
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = tags.exec(html)) !== null) {
    if (m[2].toLowerCase() !== "div") continue
    depth += m[1] ? -1 : 1
    if (depth === 0) return html.slice(start, m.index)
  }
  return null
}

// The text-sanitising helpers below (numericEntity through stripTags) are
// adapted from the linkedin-search portal CLI (MIT), originally in
// ai-job-search-dev/ai-job-search and now in ai-job-search-dev/community-portals
// at portals/global/linkedin-search; synced with its hidden-text fixes.

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 * Listing text is third-party data, and these arrive raw in a portal's JSON or
 * markup as easily as through a numeric entity.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

// Quoted attribute values may hold `>` or a close-tag string; neither ends the tag.
// As in a browser, only a quote right after `=` opens a value (`href=x'y` holds a
// plain apostrophe), and a value left open runs to the end of the input, so a
// hidden tag with one still counts as a (never-closed) hidden element.
// The alternatives are mutually exclusive (a bare `=` only when no quote follows,
// and `[^>=]` never takes an `=`), so any input has one parse and a failed match
// backtracks in linear time, not exponential.
const ATTRS = String.raw`(?:=\s*"[^"]*(?:"|$)|=\s*'[^']*(?:'|$)|=(?!\s*["'])|[^>=])*`
const TAG_END = String.raw`(?:>|$)`

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: string): boolean {
  for (const m of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ""
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) {
      return true
    }
  }
  return false
}

/**
 * Drop markup a browser never renders - comments (including Word's
 * conditional ones), <script>/<style>/<template> blocks, and elements marked
 * hidden - before tags are stripped. A plain tag strip keeps their text, which
 * hands the model words the posting's reader never saw. CSS-only tricks
 * (off-screen, zero font size) need a renderer and are not caught here.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  // One pass, collecting what is kept: slicing the string per hidden element
  // would make a page full of them quadratic.
  const open = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)(\\s${ATTRS})?${TAG_END}`, "g")
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag)) {
      // Skip to the matching close tag, counting nested same-name elements. An
      // unclosed hidden element runs to the end: failing closed drops visible
      // text, failing open would leak the hidden text.
      // Every tag is matched whole, so a close tag inside a quoted attribute is skipped.
      const same = new RegExp(`<(/?)([a-zA-Z][a-zA-Z0-9-]*)${ATTRS}${TAG_END}`, "g")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
        if (s[2].toLowerCase() !== tag) continue
        if (s[1]) depth--
        else depth++
        if (depth === 0) {
          end = same.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    open.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

function stripTags(html: string): string {
  // Only `<` followed by a tag name opens a tag, as in a browser: `C++ < 3` is text.
  return visibleHtml(html).replace(new RegExp(`</?[a-zA-Z]${ATTRS}${TAG_END}`, "g"), " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  // Collapse again after decoding: &nbsp; only becomes whitespace here, and
  // Djinni descriptions use it for blank spacer lines.
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/** Render description HTML as text, keeping paragraph and line breaks as newlines. */
function descriptionText(html: string): string | null {
  // Hidden markup goes before the line split: a hidden element can span the
  // breaks, and cleaning line by line would only see half of it.
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  // Clean each rendered line separately: stripTags collapses whitespace,
  // so applying it to the whole description erased these boundaries.
  return withBreaks.split("\n").map(clean).join("\n").replace(/\n{3,}/g, "\n\n").trim() || null
}

/** The subset of a schema.org JobPosting this CLI reads. Every field is untrusted input. */
interface LdPosting {
  identifier?: unknown
  title?: unknown
  url?: unknown
  datePosted?: unknown
  validThrough?: unknown
  employmentType?: unknown
  jobLocationType?: unknown
  category?: unknown
  description?: unknown
  experienceRequirements?: { monthsOfExperience?: unknown } | null
  hiringOrganization?: { name?: unknown } | null
  jobLocation?: unknown
}

/** Every JobPosting in the page's JSON-LD blocks. A block that fails to parse is skipped, not fatal. */
function jsonLdPostings(html: string): LdPosting[] {
  const out: LdPosting[] = []
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown
    try {
      data = JSON.parse(m[1])
    } catch {
      continue
    }
    for (const item of Array.isArray(data) ? data : [data]) {
      if (item && typeof item === "object" && (item as Record<string, unknown>)["@type"] === "JobPosting") {
        out.push(item as LdPosting)
      }
    }
  }
  return out
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : null
}

/** "2026-10-30T14:43:11.372863" -> "2026-10-30". */
function isoDay(value: unknown): string | null {
  return str(value)?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
}

const DJINNI_HOST = /(^|\.)djinni\.co$/i

/** A posting URL from JSON-LD, kept only when it points at a djinni.co job page. */
function djinniJobUrl(value: unknown): string | null {
  const s = str(value)
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === "https:" && DJINNI_HOST.test(u.hostname) && u.pathname.startsWith("/jobs/") ? u.toString() : null
  } catch {
    return null
  }
}

/** Cities from JSON-LD jobLocation (one Place or a list), or the country where a Place names no city. */
function officeNames(jobLocation: unknown): string[] {
  const places = Array.isArray(jobLocation) ? jobLocation : jobLocation ? [jobLocation] : []
  const names: string[] = []
  for (const place of places) {
    const address = (place as { address?: Record<string, unknown> } | null)?.address
    if (!address || typeof address !== "object") continue
    const raw = address.addressLocality
    const cities = (Array.isArray(raw) ? raw : [raw]).map(str).filter((c): c is string => c !== null)
    const country = str(address.addressCountry)
    for (const name of cities.length ? cities : country ? [country] : []) {
      if (!names.includes(name)) names.push(name)
    }
  }
  return names
}

function ldFields(ld: LdPosting | undefined) {
  const months = ld?.experienceRequirements?.monthsOfExperience
  const type = ld?.employmentType
  return {
    date: isoDay(ld?.datePosted),
    remoteOnly: ld ? ld.jobLocationType === "TELECOMMUTE" : null,
    offices: officeNames(ld?.jobLocation),
    employmentType: Array.isArray(type) ? type.filter((t) => typeof t === "string").join(", ") || null : str(type),
    experienceYears: typeof months === "number" && Number.isFinite(months) && months >= 0 ? Math.round((months / 12) * 10) / 10 : null,
    category: str(ld?.category),
  }
}

const ENGLISH_LABEL = /^(?:Англійська|English)(?:\s|$|[-–—:])/i
// Detail-sidebar labels: "Українська Носій мови", "Англійська B1 – Середній".
const LANGUAGE_LABEL = /^\p{Lu}\p{Ll}+\s+(?:[ABC][12]\b|Носій мови|Native)/u
const WORKPLACE_LABEL = /Офіс|Віддален|Гібрид|Office|Remote|Hybrid/i

/** "Англійська - B1" (search card) or "Англійська B1 – Середній" (detail sidebar) -> "B1". */
export function englishLevel(text: string | null | undefined): string | null {
  if (!text || !ENGLISH_LABEL.test(text)) return null
  const rest = text.replace(/^(?:Англійська|English)\s*[-–—:]?\s*/i, "").trim()
  if (!rest) return null
  return rest.match(/^([ABC][12])\b/)?.[1] ?? rest
}

/** Public salary ("до $6000") and/or Djinni's relative tier ("$$$") from a header fragment. */
function salaryFields(header: string): { salary: string | null; salaryTier: string | null } {
  const pub = header.match(/<strong class="text-success[^"]*"[^>]*>([\s\S]*?)<\/strong>/i)
  const tier = header.match(/<span class="text-body-tertiary[^"]*"[^>]*>\s*(\$+)\s*<\/span>/i)
  return { salary: pub ? clean(pub[1]) || null : null, salaryTier: tier ? tier[1] : null }
}

/** The result count Djinni prints next to the page heading, or null if absent. */
export function parseTotal(html: string): number | null {
  const m = html.match(/<\/h1>\s*<span class="fs-1[^"]*"[^>]*>\s*(\d+)\s*<\/span>/i)
  return m ? parseInt(m[1], 10) : null
}

export interface SearchParseOptions {
  /** Keep only postings dated within this many days. */
  maxAgeDays?: number
  /** Clock for the age filter, in epoch milliseconds (tests pin it). */
  now?: number
}

/**
 * Parse a search-results page. Cards are split on their `job-item-<id>` anchor
 * and parsed independently, so one malformed card cannot break the rest; each
 * is joined to its JSON-LD entry by id for the fields the card does not show.
 */
export function parseSearchPage(html: string, opts: SearchParseOptions = {}): JobCard[] {
  const byId = new Map<string, LdPosting>()
  for (const p of jsonLdPostings(html)) {
    const id = typeof p.identifier === "number" || typeof p.identifier === "string" ? String(p.identifier) : ""
    if (/^\d+$/.test(id)) byId.set(id, p)
  }
  const now = opts.now ?? Date.now()

  const results: JobCard[] = []
  const main = html.split(/<\/main>/i)[0]
  for (const chunk of main.split('<div id="job-item-').slice(1)) {
    const id = chunk.match(/^(\d+)"/)?.[1]
    if (!id) continue
    const ld = byId.get(id)

    // The <header> holds title, company and salary; the row after it holds
    // remote mode, location, experience and English; the teaser comes last.
    const headerEnd = chunk.search(/<\/header>/i)
    const header = headerEnd === -1 ? chunk : chunk.slice(0, headerEnd)
    const descStart = chunk.indexOf('id="job-description-')
    const meta = chunk.slice(headerEnd === -1 ? 0 : headerEnd, descStart === -1 ? undefined : descStart)

    const href = chunk.match(/href="(\/jobs\/\d+-[^"?#]*)"/)?.[1]
    const url = href ? BASE_URL + decodeHtmlEntities(href) : djinniJobUrl(ld?.url)
    if (!url) continue

    const titleHtml = header.match(/class="job-item__position[^"]*"[^>]*>([\s\S]*?)<\/h2>/i)?.[1]
    const title = (titleHtml ? clean(titleHtml) : "") || str(ld?.title)
    if (!title) continue

    if (opts.maxAgeDays !== undefined) {
      const posted = Date.parse(str(ld?.datePosted) ?? "")
      // An unknown date cannot be shown to be fresh, so it does not pass a freshness filter.
      if (!Number.isFinite(posted) || now - posted > opts.maxAgeDays * 86_400_000) continue
    }

    const companyHtml = header.match(/<span class="small text-gray-800[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
    const locationHtml = meta.match(/class="location-text"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
    const labels = [...meta.matchAll(/<span class="text-nowrap"[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => clean(m[1]))

    results.push({
      id,
      title,
      company: (companyHtml ? clean(companyHtml) : "") || str(ld?.hiringOrganization?.name),
      location: locationHtml ? clean(locationHtml) || null : null,
      url,
      english: englishLevel(labels.find((t) => ENGLISH_LABEL.test(t))),
      ...salaryFields(header),
      ...ldFields(ld),
    })
  }
  return results
}

/** Parse a single posting's page. `fetchedUrl` is the fallback when the page carries no canonical URL. */
export function parseJobDetail(html: string, id: string, fetchedUrl: string): JobDetail | null {
  const postings = jsonLdPostings(html)
  const ld = postings.find((p) => String(p.identifier) === id) ?? postings[0]
  const descHtml = extractDivContent(html, "job-post__description")
  // Neither the structured data nor the description block: not a posting page.
  if (!ld && descHtml === null) return null

  const descIdx = html.search(/class="[^"]*job-post__description/i)
  const header = descIdx === -1 ? html : html.slice(0, descIdx)
  const titleHtml = header.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const companyHtml = header.match(/<a\s[^>]*href="https:\/\/djinni\.co\/jobs\/company-[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1]

  const aside = html.match(/<aside\b[\s\S]*?<\/aside>/i)?.[0] ?? ""
  const locationHtml = aside.match(/class="location-text"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
  const labels = [...aside.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/gi)].map((m) => clean(m[1]))

  let description = descHtml !== null ? descriptionText(descHtml) : null
  if (!description && typeof ld?.description === "string") {
    description =
      ld.description
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim() || null
  }

  return {
    id,
    title: (titleHtml ? clean(titleHtml) : "") || str(ld?.title) || "(untitled)",
    company: (companyHtml ? clean(companyHtml) : "") || str(ld?.hiringOrganization?.name),
    location: locationHtml ? clean(locationHtml) || null : null,
    url: djinniJobUrl(ld?.url) ?? fetchedUrl,
    english: englishLevel(labels.find((t) => ENGLISH_LABEL.test(t))),
    ...salaryFields(header),
    ...ldFields(ld),
    workplace: labels.find((t) => WORKPLACE_LABEL.test(t)) ?? null,
    languages: labels.filter((t) => LANGUAGE_LABEL.test(t)),
    validThrough: isoDay(ld?.validThrough),
    description,
  }
}

// Djinni needs a slug in a posting's path: /jobs/<id>/ is a 404, while any
// /jobs/<id>-<slug>/ redirects to the canonical slug (verified 2026-10-30).
const PLACEHOLDER_SLUG = "x"

/**
 * Accept a raw job id, an "<id>-<slug>" path segment, or a djinni.co job URL
 * (with or without scheme), and return the id and the path to fetch. A URL on
 * any other host is rejected; host and path are read through real URL parsing,
 * so look-alike hosts (djinni.co.evil.io) and userinfo tricks
 * (djinni.co@evil.io) fall on the reject side.
 */
export function detailTarget(input: string): { id: string; path: string } | null {
  const trimmed = input.trim()
  if (/^\d{4,}$/.test(trimmed)) return { id: trimmed, path: `/jobs/${trimmed}-${PLACEHOLDER_SLUG}/` }
  const segment = trimmed.match(/^(\d{4,})-([^/\s?#]+)\/?$/)
  if (segment) return { id: segment[1], path: `/jobs/${segment[1]}-${segment[2]}/` }

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!DJINNI_HOST.test(parsed.hostname)) return null
    const m = parsed.pathname.match(/^\/jobs\/(\d{4,})(?:-([^/]+))?\/?$/)
    return m ? { id: m[1], path: `/jobs/${m[1]}-${m[2] ?? PLACEHOLDER_SLUG}/` } : null
  }
  return null
}
