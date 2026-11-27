#!/usr/bin/env bun
// Self-contained CLI for searching Google Jobs (Google's jobs panel) through the
// Apify Actor `krammer/google-jobs-scraper`. It calls only api.apify.com and
// needs the user's own Apify token in APIFY_API_TOKEN; zero runtime
// dependencies, so it runs anywhere `bun` is available.
//
// Google's terms restrict automated access to its services, and the Actor is
// metered. Keep volume low and use it for personal use. Run it on your own
// responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { COUNTRIES, MAX_RESULT_WINDOW, type Country } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `google-jobs-cli — search Google Jobs through an Apify Actor

USAGE
  bun run src/cli.ts search --query "<text>" [flags]
  bun run src/cli.ts detail <dataset_id>:<offset> [--format json|plain]

Requires APIFY_API_TOKEN in the environment. The Actor is metered: each search
starts one Actor run, and reaching page N costs a run that returns page*limit
results.

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, or role). REQUIRED.
  --location, -l <text>   Location to search, e.g. "Chicago, IL".
  --country <code>        Country of the search: us (default) | gb | in | de.
  --jobage <days>         Posted within N days: 1, 2-3, 4-7, 8-30, >30. Default: any.
  --remote                Only remote postings.
  --page <n>              1-indexed page. Default 1.
  --limit, -n <n>         Results per page. Default 10, maximum 200.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "software engineer" -l "San Francisco, CA" --jobage 7 --format table
  bun run src/cli.ts search -q "registered nurse" -l "Boston, MA" --jobage 1 --format table
  bun run src/cli.ts search -q "data analyst" --remote --limit 20 --format table
  bun run src/cli.ts detail jPV8SE3dHqcuO2M3C:0 --format plain

Personal use only. The Actor is metered; Google's terms restrict automated access.
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/l/n to these before validation). "help"/"h" pass so `search --help`
// still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "country", "jobage", "remote", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error. add-portal.md's
  // contract requires a bogus flag to exit 1 with a JSON error on stderr.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored; see --help for the supported flags`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  // A positional argument the command does not use is rejected, not ignored:
  // `search -q engineer typo` would otherwise start a metered search with no
  // sign that "typo" was dropped. `search` takes none past its name; `detail`
  // takes exactly one, the id.
  if (cmd === "search" || cmd === "detail") {
    const allowed = cmd === "detail" ? 2 : 1
    if ((flags._ as string[]).length > allowed) {
      const extra = (flags._ as string[]).slice(allowed)
      process.stderr.write(
        JSON.stringify({
          error: `unexpected positional argument${extra.length > 1 ? "s" : ""} ${extra.map((a) => `"${a}"`).join(", ")} for '${cmd}' - only flags are read after the command${cmd === "detail" ? " and its <id>" : ""}; see --help`,
          code: "BAD_ARG",
        }) + "\n",
      )
      return 1
    }
  }

  // Numbers are validated as whole numbers >= 1, never truncated: a fractional
  // or zero value would otherwise change a filter silently.
  const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
    const val = typeof raw === "string" ? Number(raw.trim()) : NaN
    if (!Number.isInteger(val) || val < 1) {
      process.stderr.write(
        JSON.stringify({ error: `--${name} must be a whole number of at least 1, got "${raw}"`, code: "BAD_ARG" }) + "\n",
      )
      return null
    }
    return val
  }

  if (cmd === "search") {
    if (typeof flags.query !== "string" || !flags.query.trim()) {
      process.stderr.write(
        JSON.stringify({ error: 'the --query/-q flag is required (e.g. -q "software engineer")', code: "NO_QUERY" }) + "\n",
      )
      return 1
    }
    if (flags.location !== undefined && (typeof flags.location !== "string" || !flags.location.trim())) {
      process.stderr.write(
        JSON.stringify({ error: "--location requires a non-empty value", code: "BAD_ARG" }) + "\n",
      )
      return 1
    }
    const country = flags.country !== undefined ? String(flags.country).trim().toLowerCase() : "us"
    if (!(COUNTRIES as readonly string[]).includes(country)) {
      process.stderr.write(
        JSON.stringify({
          error: `--country must be one of ${COUNTRIES.join("|")}, got "${country}"`,
          code: "BAD_ARG",
        }) + "\n",
      )
      return 1
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      process.stderr.write(
        JSON.stringify({ error: `--format must be one of json|table|plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }
    // A bare --remote is the intended true; any other use is a stray flag.
    if (flags.remote !== undefined && flags.remote !== true) {
      process.stderr.write(
        JSON.stringify({ error: "--remote takes no value; it is a boolean flag", code: "BAD_ARG" }) + "\n",
      )
      return 1
    }

    let jobage: number | undefined
    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      jobage = v
    }
    let page = 1
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      page = v
    }
    let limit = 10
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }
    if (limit > MAX_RESULT_WINDOW) {
      process.stderr.write(
        JSON.stringify({ error: `--limit must be at most ${MAX_RESULT_WINDOW}, got ${limit}`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }
    // The Actor's maxResultsPerSearch is capped at 200; a page that would need
    // more is rejected before any request, so no run is billed for nothing.
    if (page * limit > MAX_RESULT_WINDOW) {
      process.stderr.write(
        JSON.stringify({
          error: `page ${page} with limit ${limit} needs ${page * limit} results per run, past this portal's ${MAX_RESULT_WINDOW}-result window (page*limit must be <= ${MAX_RESULT_WINDOW})`,
          code: "PAGE_TOO_DEEP",
        }) + "\n",
      )
      return 1
    }

    const opts: SearchOpts = {
      query: flags.query,
      location: typeof flags.location === "string" ? flags.location : undefined,
      country: country as Country,
      jobage,
      remote: flags.remote === true,
      page,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(
        JSON.stringify({ error: "detail requires an <id> in the form <dataset_id>:<offset>", code: "NO_ID" }) + "\n",
      )
      return 1
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) {
      process.stderr.write(
        JSON.stringify({ error: `--format must be one of json|plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
