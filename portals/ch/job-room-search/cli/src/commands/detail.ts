import { DETAIL_URL, getJson, stripInvisible, toDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

// job-room IDs are UUIDs (e.g. e75c4b4a-ff96-477c-908b-91fd6416fdfc), not numeric like LinkedIn.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function normalizeId(input: string): string | null {
  const m = input.match(UUID_RE)
  if (m) return m[0]
  // Accept a full job-room URL containing the UUID somewhere in the path/query.
  const embedded = input.match(
    /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
  )
  return embedded ? embedded[1] : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job-room UUID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const res = await getJson(`${DETAIL_URL}/${id}`)
    if (res.status === 404) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    if (res.status !== 200) {
      writeError(`job-room detail failed: HTTP ${res.status} — ${res.body.slice(0, 300)}`, "DETAIL_FAILED")
      return 1
    }
    const job = stripInvisible(toDetail(JSON.parse(res.body)))

    if (opts.format === "plain") {
      // Optional lines are null, not "", so filtering them out leaves the
      // deliberate "" separators in place and the description keeps its spacing.
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.city || "—"} (${job.cantonCode || "—"})`,
        "",
        job.permanent !== null ? `Permanent: ${job.permanent ? "yes" : "no"}` : null,
        job.workloadMin ? `Workload: ${job.workloadMin}${job.workloadMax && job.workloadMax !== job.workloadMin ? `-${job.workloadMax}` : ""}%` : null,
        job.onlineSince ? `Online since: ${job.onlineSince}` : null,
        "",
        job.description || "(no description)",
        "",
        `job-room id: ${job.id}`,
        job.externalUrl ? `External listing (may syndicate from jobup.ch or similar): ${job.externalUrl}` : null,
      ].filter((l): l is string => l !== null)
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
