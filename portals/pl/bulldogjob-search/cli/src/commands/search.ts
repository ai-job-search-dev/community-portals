import {
  PAGE_SIZE,
  PortalError,
  buildListUrl,
  htmlFetch,
  jobUrl,
  parseDetail,
  parseSearch,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  /** Explicit skill filter. When set, every word of `query` is a client-side title/tag term. */
  skill?: string
  role?: string
  level?: string
  city?: string
  jobage?: number
  /** Fetch each result's detail page for its publication date (one request per result). Implied by jobage. */
  dates?: boolean
  page: number
  all?: boolean
  /** Pause between swept pages / date lookups; tests pass 0. Not a CLI flag. */
  pageDelayMs?: number
  limit?: number
  format: "json" | "table" | "plain"
}

/** Hard cap for sweeps: 10 pages = 500 offers per query. Not configurable. */
export const MAX_PAGES = 10
const PAGE_DELAY_MS = 1500
const DATE_DELAY_MS = 300

const fold = (s: string): string =>
  s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "")

/**
 * bulldogjob has no free-text search: its list pages filter by skill, role, level and
 * city only. So the first word of --query becomes the server-side skill filter and the
 * remaining words must all appear in the offer's title or technology tags. With an
 * explicit --skill, every query word is such a term.
 */
export function resolveQuery(query: string | undefined, skill: string | undefined): { skill?: string; terms: string[] } {
  const words = (query ?? "").trim().split(/\s+/).filter(Boolean)
  if (skill) return { skill, terms: words }
  return { skill: words[0], terms: words.slice(1) }
}

export function matchesTerms(card: JobCard, terms: string[]): boolean {
  if (terms.length === 0) return true
  const hay = fold(`${card.title} ${card.tags.join(" ")}`)
  return terms.every((t) => hay.includes(fold(t)))
}

const idNum = (c: JobCard): number => parseInt(c.id, 10) || 0

/** Newest first. Offer ids grow with creation time, so they order undated results; a date, when known, leads. */
export function sortNewestFirst(cards: JobCard[]): JobCard[] {
  const key = (c: JobCard) => (c.postedAt ? Date.parse(c.postedAt) || 0 : 0)
  return [...cards].sort((a, b) => key(b) - key(a) || idNum(b) - idNum(a))
}

/** Local-midnight cutoff for --jobage N: today and the N previous calendar days. */
export function jobageCutoff(days: number, now: number = Date.now()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return d.getTime()
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(8) + " " + "TITLE".padEnd(44) + " " + "COMPANY".padEnd(22) + " " + "LOCATION".padEnd(16) + " " + "SALARY".padEnd(22) + " DATE"
  const rows = cards.map(
    (c) =>
      `${String(idNum(c)).padEnd(8)} ${c.title.slice(0, 44).padEnd(44)} ${(c.company || "—").slice(0, 22).padEnd(22)} ${(c.location || "—").slice(0, 16).padEnd(16)} ${(c.salary || "—").slice(0, 22).padEnd(22)} ${c.date || "—"}`,
  )
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchCards(opts: SearchOpts, skill: string | undefined, sweep: boolean) {
  const seen = new Set<string>()
  const cards: JobCard[] = []
  let total = 0
  let pages = 0
  let lastPageFull = false
  const lastPage = sweep ? opts.page + MAX_PAGES - 1 : opts.page
  for (let page = opts.page; page <= lastPage; page++) {
    if (pages > 0) await sleep(opts.pageDelayMs ?? PAGE_DELAY_MS)
    const url = buildListUrl({ skill, role: opts.role, level: opts.level, city: opts.city, page })
    const html = await htmlFetch(url)
    if (!html) throw new PortalError(`list page not found: ${url}`, "NOT_FOUND")
    const parsed = parseSearch(html)
    total = parsed.total
    pages++
    const fresh = parsed.cards.filter((c) => !seen.has(c.id))
    for (const c of fresh) {
      seen.add(c.id)
      cards.push(c)
    }
    // Judge "full page" from the entries the server sent, not those that parsed:
    // one malformed entry on a full page must not make it look like the last.
    lastPageFull = parsed.rawCount >= PAGE_SIZE
    if (fresh.length === 0 || !lastPageFull) break
  }
  // Truncated only if the server reports offers beyond the pages read; a sweep
  // of exactly MAX_PAGES full pages with nothing after is complete.
  const readThrough = (opts.page - 1 + pages) * PAGE_SIZE
  return { cards, total, pages, truncated: sweep && pages === MAX_PAGES && lastPageFull && total > readThrough }
}

/** Fill date/postedAt from each offer's detail page. Returns the ids whose lookup failed. */
async function addDates(cards: JobCard[], delayMs: number): Promise<string[]> {
  const failed: string[] = []
  for (let i = 0; i < cards.length; i++) {
    if (i > 0) await sleep(delayMs)
    try {
      const html = await htmlFetch(jobUrl(cards[i].id))
      if (!html) throw new Error("not found")
      const d = parseDetail(html, cards[i].id)
      cards[i].date = d.date
      cards[i].postedAt = d.postedAt
    } catch {
      failed.push(cards[i].id)
    }
  }
  return failed
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const { skill, terms } = resolveQuery(opts.query, opts.skill)
    // Text terms are matched client-side, so a match may sit on any page: read them all.
    const sweep = Boolean(opts.all) || terms.length > 0
    const { cards: fetched, total, pages, truncated } = await fetchCards(opts, skill, sweep)
    let cards = stripInvisible(fetched).filter((c) => matchesTerms(c, terms))

    if (opts.dates || opts.jobage !== undefined) {
      const failed = await addDates(cards, opts.pageDelayMs ?? DATE_DELAY_MS)
      if (failed.length > 0) {
        process.stderr.write(
          JSON.stringify({
            warning: `could not read the publication date of ${failed.length} offer(s); they have date null${opts.jobage !== undefined ? " and are kept despite --jobage" : ""}: ${failed.join(", ")}`,
            code: "DATE_LOOKUP_FAILED",
          }) + "\n",
        )
      }
      if (opts.jobage !== undefined) {
        const cutoff = jobageCutoff(opts.jobage)
        cards = cards.filter((c) => !c.postedAt || Date.parse(c.postedAt) >= cutoff)
      }
    }

    cards = sortNewestFirst(cards)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)
    if (truncated) {
      process.stderr.write(
        JSON.stringify({
          warning: `sweep stopped at the ${MAX_PAGES}-page cap (${MAX_PAGES * PAGE_SIZE} offers) with more still available - narrow the filters, or offers past the cap are missed`,
          code: "PAGE_CAP_REACHED",
        }) + "\n",
      )
    }

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.salary || "no salary"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, total, page: opts.page, pages, truncated }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof PortalError ? e.code : "SEARCH_FAILED")
    return 1
  }
}
