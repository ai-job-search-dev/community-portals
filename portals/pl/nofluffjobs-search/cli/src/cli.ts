#!/usr/bin/env bun
// Self-contained CLI for searching jobs on nofluffjobs.com's public listing
// pages. No external CLI framework and no runtime dependencies, so it runs
// anywhere `bun` is available with nothing installed beyond the repo clone.
//
// Personal use only. This reads No Fluff Jobs' public, robots-permitted /pl and
// /job/ pages. Keep volume low, and do not use it commercially or for bulk data
// collection.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", c: "category" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
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

const HELP = `nofluffjobs-cli — search jobs on nofluffjobs.com (Polish IT job board)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (title, skill, technology). Recommended.
  --location, -l <place>  City, or "Remote". e.g. "Warszawa", "Kraków", "Remote".
  --category, -c <slug>   backend | frontend | fullstack | devops | testing | data | mobile | ...
  --seniority <level>     trainee | junior | mid | senior | expert
  --page <n>              1-indexed. The portal accumulates: page N returns
                          offers 1..20N, de-duplicated. Default 1.
  --all                   Read the 10-page view (offers 1..200) in ONE request. Hard
                          cap; conflicts with --page. If the portal holds more
                          matches, meta.truncated is set and PAGE_CAP_REACHED warned.
  --dates                 Fill each result's publication date. Free: read from the
                          page's embedded state; only results it leaves undated cost
                          a detail request each (at most 30).
  --jobage <days>         Posted within N days (calendar days; yesterday's postings
                          count under --jobage 1). Implies --dates.
  --limit, -n <n>         Cap results.

Results are always newest first (sort=newest), and only real matches are returned.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "PHP Symfony" --format table
  bun run src/cli.ts search -q "symfony" -l Remote --seniority senior --format table
  bun run src/cli.ts search -c backend -l Remote --seniority senior --limit 10 --dates
  bun run src/cli.ts search -q "payments" -l "Warszawa" --page 2 --format table
  bun run src/cli.ts search -q "php" -l Remote --jobage 14 --limit 20 --format json
  bun run src/cli.ts detail mid-senior-symfony-developer-legacy-modernization-fluent-english-polcode-remote --format plain

Personal use only — reads nofluffjobs.com's public pages; keep volume low.
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/l/n/c to these before validation). "help"/"h" pass so `search --help`
// still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "location", "category", "seniority", "page", "all", "dates", "jobage", "limit", "format", "help", "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

const SENIORITY = ["trainee", "junior", "mid", "senior", "expert"]

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = parseInt(raw as string, 10)
      if (isNaN(val)) {
        process.stderr.write(
          JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n",
        )
        return null
      }
      return val
    }

    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] === undefined) continue
      const v = parseIntFlag(name, flags[name]!)
      if (v === null) return 1
      if (v <= 0) {
        process.stderr.write(
          JSON.stringify({ error: `--${name} must be a positive number, got "${flags[name]}"`, code: "BAD_ARG" }) + "\n",
        )
        return 1
      }
      flags[name] = String(v)
    }

    const seniority = typeof flags.seniority === "string" ? flags.seniority.toLowerCase() : undefined
    if (seniority && !SENIORITY.includes(seniority)) {
      process.stderr.write(
        JSON.stringify({
          error: `--seniority must be one of ${SENIORITY.join(" | ")}, got "${seniority}"`,
          code: "BAD_ARG",
        }) + "\n",
      )
      return 1
    }

    const jobage = flags.jobage ? parseInt(flags.jobage as string, 10) : undefined
    const limit = flags.limit ? parseInt(flags.limit as string, 10) : undefined
    const wantsDates = flags.dates === true || jobage !== undefined
    // Dates now come from the page's embedded state at no extra cost; only results
    // it leaves undated fall back to a detail request each, capped in search.ts -
    // so --dates/--jobage no longer need a --limit to stay polite.

    if (flags.all !== undefined && flags.all !== true) {
      process.stderr.write(JSON.stringify({ error: "--all takes no value", code: "BAD_ARG" }) + "\n")
      return 1
    }
    if (flags.all === true && flags.page !== undefined) {
      process.stderr.write(
        JSON.stringify({
          error: "--all reads the 10-page view from the first page; it cannot be combined with --page",
          code: "CONFLICTING_PAGE_FLAGS",
        }) + "\n",
      )
      return 1
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      category: typeof flags.category === "string" ? flags.category : undefined,
      seniority,
      page: flags.page ? parseInt(flags.page as string, 10) : 1,
      all: flags.all === true,
      jobage,
      dates: wantsDates,
      limit,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires a <slug|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = { id, format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"] }
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
