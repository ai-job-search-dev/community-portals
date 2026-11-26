import {
  API_BASE,
  PAGE_SIZE,
  boardExists,
  isJobId,
  isPublicPosting,
  jsonFetch,
  matchesLocation,
  stripInvisible,
  toCard,
  withinDays,
  writeError,
  type ApiPosting,
  type ApiPostingList,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  board: string
  query?: string
  location?: string
  city?: string
  country?: string
  region?: string
  remote?: string
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const idWidth = cards.reduce((width, c) => Math.max(width, c.id.length), 10)
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 48).padEnd(48)
    const loc = (c.location || "—").slice(0, 34).padEnd(34)
    const type = (c.employmentType || "—").slice(0, 11).padEnd(11)
    const date = (c.date || "—").slice(0, 10).padEnd(10)
    return `${c.id.padEnd(idWidth)} ${title} ${loc} ${type} ${date}`
  })
  const header = "ID".padEnd(idWidth) + " " + "TITLE".padEnd(48) + " " + "LOCATION".padEnd(34) + " " + "TYPE".padEnd(11) + " " + "POSTED".padEnd(10)
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

/** The list URL. `q` is SmartRecruiters' own keyword search, so it is not filtered again client-side. */
export function searchUrl(opts: Pick<SearchOpts, "board" | "query" | "city" | "country" | "region" | "remote" | "jobage" | "page">): string {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((opts.page - 1) * PAGE_SIZE),
    destination: "PUBLIC",
  })
  if (opts.query) params.set("q", opts.query)
  if (opts.city) params.set("city", opts.city)
  if (opts.country) params.set("country", opts.country)
  if (opts.region) params.set("region", opts.region)
  if (opts.remote) {
    for (const mode of opts.remote.split(",")) params.append("locationType", mode.toUpperCase())
  }
  if (opts.jobage) {
    const cutoff = Date.now() - opts.jobage * 86400000
    if (Number.isFinite(cutoff) && Math.abs(cutoff) <= 8.64e15) {
      params.set("releasedAfter", new Date(cutoff).toISOString())
    }
  }
  return `${API_BASE}/${opts.board}/postings?${params}`
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    // A free-text location that is also an exact city can be filtered by the
    // board itself. Try that first; if the board has no such city, fall back to
    // the page substring filter and warn that the result is page-scoped.
    let pageScopedLocation = Boolean(opts.location)
    let data: ApiPostingList | null
    if (opts.location && !opts.city) {
      data = await jsonFetch<ApiPostingList>(searchUrl({ ...opts, city: opts.location }))
      if (data && Array.isArray(data.content) && (data.content.length > 0 || (data.totalFound ?? 0) > 0)) {
        pageScopedLocation = false
      } else if (data && Array.isArray(data.content)) {
        // The combined query can be empty because of --remote, --jobage or the
        // keyword, not because the city is unknown. Check the city alone before
        // falling back to the page and warning about the city.
        let cityExists = false
        try {
          const probe = await jsonFetch<ApiPostingList>(searchUrl({ board: opts.board, city: opts.location, page: 1 }))
          cityExists = !!probe && Array.isArray(probe.content) && (probe.content.length > 0 || (probe.totalFound ?? 0) > 0)
        } catch {
          // A failed probe falls back to the page, as before.
        }
        if (!cityExists) {
          data = await jsonFetch<ApiPostingList>(searchUrl(opts))
        } else {
          pageScopedLocation = false
        }
      }
    } else {
      data = await jsonFetch<ApiPostingList>(searchUrl(opts))
    }

    if (!data) {
      writeError(`No SmartRecruiters board named "${opts.board}" (HTTP 404)`, "BOARD_NOT_FOUND")
      return 1
    }
    if (!Array.isArray(data.content)) {
      const got = data && typeof data === "object" ? Object.keys(data).join(", ") : typeof data
      writeError(`Unexpected response for board "${opts.board}" - expected content[], got: [${got}]`, "SEARCH_FAILED")
      return 1
    }

    // The postings list answers 200 with an empty page for an unknown identifier.
    // Probe the keyless Common Elements endpoint so a typo is not reported as a
    // board with no open roles. A failed probe keeps the list's empty result.
    if (data.content.length === 0 && (data.totalFound ?? 0) === 0) {
      try {
        if (!(await boardExists(opts.board))) {
          writeError(`No SmartRecruiters board named "${opts.board}" (HTTP 404)`, "BOARD_NOT_FOUND")
          return 1
        }
      } catch {
        // The list request succeeded; an unavailable probe does not change that.
      }
    }

    // Sanitize before matching, so an invisible character cannot hide a visible match.
    const all = data.content
      .filter((raw): raw is ApiPosting => raw !== null && typeof raw === "object" && typeof raw.id === "string" && isJobId(raw.id.trim()))
      .filter(isPublicPosting)
      .map((raw) => stripInvisible(toCard(raw, opts.board)))
    const matched = all.filter(
      (c) => matchesLocation(c.location, opts.location) && withinDays(c.date, opts.jobage),
    )
    let cards = matched
    if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (cards.length === 0
          ? "No results."
          : cards
              .map((c) => {
                const extras = [
                  c.department,
                  c.function && c.function !== c.department ? c.function : null,
                  c.employmentType,
                  c.requisitionId ? `ref ${c.requisitionId}` : null,
                ].filter(Boolean).join(" · ")
                return [
                  c.title,
                  `  ${c.company || "—"} · ${c.location || "—"} · ${c.date?.slice(0, 10) || "—"}`,
                  ...(extras ? [`  ${extras}`] : []),
                  `  id: ${c.id}`,
                  `  ${c.url}`,
                ].join("\n")
              })
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: cards.length,
              page: opts.page,
              perPage: PAGE_SIZE,
              board: opts.board,
              matched: matched.length,
              total: typeof data.totalFound === "number" ? data.totalFound : null,
            },
            results: cards,
          },
          null,
          2,
        ) + "\n",
      )
    }
    const warnings: string[] = []
    if (pageScopedLocation) {
      warnings.push("--location filters only the fetched page; use --city/--country/--region for a board-wide location filter")
    }
    if (warnings.length > 0) {
      process.stderr.write(JSON.stringify({ warning: warnings.join(" "), code: "PAGE_SCOPED_FILTER" }) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
