import { SEARCH_URL, postJson, toSummary, writeError, type JobSummary } from "../helpers.js"

export interface SearchOpts {
  query?: string
  cantons?: string[] // canton codes, e.g. ["GE","VD"]
  workloadMin?: number
  workloadMax?: number
  page: number // 1-indexed
  size: number
  sort: "date_desc" | "date_asc"
  format: "json" | "table" | "plain"
}

function buildBody(opts: SearchOpts): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (opts.query) body.keywords = [opts.query]
  if (opts.cantons && opts.cantons.length > 0) body.cantonCodes = opts.cantons
  if (opts.workloadMin !== undefined) body.workloadPercentageMin = opts.workloadMin
  if (opts.workloadMax !== undefined) body.workloadPercentageMax = opts.workloadMax
  return body
}

function renderTable(cards: JobSummary[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = `${c.city || "—"} (${c.cantonCode || "—"})`.slice(0, 22).padEnd(22)
    const wl =
      c.workloadMin && c.workloadMax
        ? c.workloadMin === c.workloadMax
          ? `${c.workloadMin}%`
          : `${c.workloadMin}-${c.workloadMax}%`
        : "—"
    return `${c.id.slice(0, 8).padEnd(9)} ${title} ${company} ${loc} ${wl.padEnd(8)} ${c.onlineSince || "—"}`
  })
  const header =
    "ID".padEnd(9) +
    " " +
    "TITLE".padEnd(40) +
    " " +
    "COMPANY".padEnd(22) +
    " " +
    "LOCATION".padEnd(22) +
    " " +
    "WORKLOAD".padEnd(8) +
    " ONLINE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const url = `${SEARCH_URL}?page=${opts.page - 1}&size=${opts.size}&sort=${opts.sort}`
    const res = await postJson(url, buildBody(opts))
    if (res.status !== 200) {
      writeError(`job-room search failed: HTTP ${res.status} — ${res.body.slice(0, 300)}`, "SEARCH_FAILED")
      return 1
    }
    const hits = JSON.parse(res.body) as unknown[]
    const cards = hits.map((h) => toSummary(h))
    const totalCount = res.headers.get("x-total-count")

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
      if (totalCount) process.stdout.write(`\n${totalCount} total matches · page ${opts.page}\n`)
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.city || "—"} (${c.cantonCode || "—"}) · ${c.onlineSince || "—"}\n  id: ${c.id}\n  ${c.externalUrl || "(no external URL — job-room only)"}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: { count: cards.length, page: opts.page, size: opts.size, totalCount: totalCount ? Number(totalCount) : null },
            results: cards,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
