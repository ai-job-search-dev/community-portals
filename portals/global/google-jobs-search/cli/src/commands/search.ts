import {
  apiToken,
  fetchDatasetItems,
  jobageToDatePosted,
  runActor,
  stripInvisible,
  toResult,
  writeError,
  type Country,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  country: Country
  jobage?: number
  remote: boolean
  page: number
  limit: number
  format: "json" | "table" | "plain"
}

/**
 * The Actor input. `maxResultsPerSearch` is page*limit, not limit: the Actor
 * has no offset parameter, so reaching page N means asking for everything up
 * to the end of page N and dropping the earlier records client-side.
 */
export function buildActorInput(opts: SearchOpts): Record<string, unknown> {
  const input: Record<string, unknown> = {
    queries: [opts.query],
    country: opts.country,
    datePosted: jobageToDatePosted(opts.jobage),
    maxResultsPerSearch: opts.page * opts.limit,
  }
  if (opts.location) input.locations = [opts.location]
  if (opts.remote) input.remoteOnly = true
  return input
}

function shortDate(date: string | null): string {
  return date || "—"
}

function renderTable(results: JobResult[]): string {
  if (results.length === 0) return "No results."
  const rows = results.map((r) => {
    const id = r.id.slice(0, 26).padEnd(26)
    const title = (r.title || "—").slice(0, 40).padEnd(40)
    const company = (r.company || "—").slice(0, 24).padEnd(24)
    const loc = (r.location || "—").slice(0, 22).padEnd(22)
    return `${id} ${title} ${company} ${loc} ${shortDate(r.date)}`
  })
  const header =
    "ID".padEnd(26) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(22) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const token = apiToken()
  if (!token) {
    writeError(
      "APIFY_API_TOKEN is not set. Create an Apify API token in Console -> Settings -> API & Integrations, then export APIFY_API_TOKEN=...",
      "MISSING_TOKEN",
    )
    return 1
  }

  try {
    const run = await runActor(buildActorInput(opts), token)
    const datasetId = run.defaultDatasetId as string

    // The dataset read asks for this page's records by their dataset offset.
    // The offset is also the tail of each result id, so `detail` can read the
    // same record back without a second Actor run.
    const start = (opts.page - 1) * opts.limit
    const items = await fetchDatasetItems(datasetId, start, opts.limit, token)
    const results = stripInvisible(items.map((item, i) => toResult(item, datasetId, start + i)))

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        results
          .map(
            (r) =>
              `${r.title || "—"}\n  ${r.company || "—"} · ${r.location || "—"} · ${shortDate(r.date)}\n  id: ${r.id}\n  ${r.url || "—"}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: results.length, page: opts.page, run_id: run.id, dataset_id: datasetId }, results },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "SEARCH_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
