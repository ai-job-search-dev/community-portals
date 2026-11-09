#!/usr/bin/env bun
// Self-contained CLI for searching jobs on bulldogjob.pl (Polish IT job board) through
// its public pages. No external CLI framework, zero runtime dependencies.
//
// Personal use only. Keep volume low and do not use it commercially or for bulk data
// collection. Run it on your own responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { CITIES, LEVELS, normalizeCity } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "city", n: "limit" }
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

const HELP = `bulldogjob-cli — search jobs on bulldogjob.pl (Polish IT job board)

USAGE
  bun run src/cli.ts search [-q "<skill> [title words]"] [filters] [flags]
  bun run src/cli.ts detail <id|slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>   bulldogjob has no free-text search. The FIRST word is the
                       server-side skill filter (e.g. PHP, Symfony, Kubernetes, Java);
                       the remaining words must all appear in the offer title or tech tags
                       (client-side). Text words read every page (up to 10 pages).
  --skill <name>       Explicit skill filter; then every -q word is a title/tag word.
  --role <name>        Role filter, e.g. backend, frontend, fullstack, devops.
  --level <level>      ${LEVELS.join(" | ")}.
  --city, -l <city>    ${CITIES.join(", ")}. "Remote" = offers that allow remote work
                       (see workModes in the output for full-remote vs hybrid).
  At least one of --query/--skill/--role/--level/--city is required.
  --jobage <days>      Posted within N calendar days (1 = today and yesterday). Needs the
                       publication date, so it reads each result's detail page (implies --dates).
  --dates              Fill date/postedAt for every result (one extra request per result).
  --page <n>           1-indexed page (50 offers/page). Default 1. Not combinable with title words.
  --all                Sweep pages until one adds nothing (hard cap 10 pages = 500 offers).
  --limit, -n <n>      Cap results emitted (client-side).
  --format <fmt>       json (default) | table | plain.

Results are sorted newest first (by date when known, else by offer id).

EXAMPLES
  bun run src/cli.ts search -q "PHP" --format table
  bun run src/cli.ts search -q "PHP architect" -l Remote --format table
  bun run src/cli.ts search --skill Symfony --level senior --jobage 14 --format json
  bun run src/cli.ts detail 260906 --format plain

Personal use only — public pages; keep volume low.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "skill", "role", "level", "city", "jobage", "dates", "page", "all", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    // An explicit --help is a success; only a bare invocation is a usage error.
    return flags.help || flags.h ? 0 : 1
  }

  // Unknown flags are rejected, never ignored: a discarded filter changes what the search returns.
  const known = KNOWN_FLAGS[cmd]
  if (known) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || known.has(key)) continue
      return fail(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
    }
  }

  // Extra positionals are never silently ignored: `search -q php Symfony` would
  // otherwise search for "php" alone.
  const positionals = flags._ as string[]
  if (cmd === "search" && positionals.length > 1) {
    return fail(`unexpected argument "${positionals[1]}" - search takes only flags; pass keywords with -q "<text>"`, "BAD_ARG")
  }
  if (cmd === "detail" && positionals.length > 2) {
    return fail(`unexpected argument "${positionals[2]}" - detail takes a single <id|slug|url>`, "BAD_ARG")
  }

  if (cmd === "search") {
    const textFlag = (name: string): string | undefined | null => {
      const v = flags[name]
      if (v === undefined) return undefined
      return typeof v === "string" && v.trim() ? v.trim() : null
    }
    const values: Record<string, string | undefined> = {}
    for (const name of ["query", "skill", "role", "level", "city"]) {
      const v = textFlag(name)
      if (v === null) return fail(`--${name} requires a non-empty value`, "BAD_ARG")
      values[name] = v
    }
    if (!values.query && !values.skill && !values.role && !values.level && !values.city) {
      return fail(
        "give at least one of --query/--skill/--role/--level/--city: with no filter the search would return the whole portal",
        "NO_FILTER",
      )
    }
    if (values.level) {
      values.level = values.level.toLowerCase()
      if (!LEVELS.includes(values.level)) return fail(`--level must be one of ${LEVELS.join("|")}, got "${values.level}"`, "BAD_ARG")
    }
    if (values.city) {
      const city = normalizeCity(values.city)
      if (!city) return fail(`--city must be one of ${CITIES.join(", ")}, got "${values.city}"`, "BAD_ARG")
      values.city = city
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")

    for (const b of ["all", "dates"]) {
      if (flags[b] !== undefined && flags[b] !== true) return fail(`--${b} takes no value`, "BAD_ARG")
    }
    if (flags.all === true && flags.page !== undefined) {
      return fail("--all sweeps every page from the first; it cannot be combined with --page", "CONFLICTING_PAGE_FLAGS")
    }

    const parseIntFlag = (name: string): number | null | undefined => {
      const raw = flags[name]
      if (raw === undefined) return undefined
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
        return null
      }
      return val
    }
    const jobage = parseIntFlag("jobage")
    const page = parseIntFlag("page")
    const limit = parseIntFlag("limit")
    if (jobage === null || page === null || limit === null) return 1

    // Title words are matched client-side across all pages, so a single --page cannot honour them.
    const words = (values.query ?? "").split(/\s+/).filter(Boolean)
    const hasTerms = values.skill ? words.length > 0 : words.length > 1
    if (hasTerms && page !== undefined) {
      return fail("title words in --query are matched across all pages; they cannot be combined with --page", "CONFLICTING_PAGE_FLAGS")
    }

    const opts: SearchOpts = {
      query: values.query,
      skill: values.skill,
      role: values.role,
      level: values.level,
      city: values.city,
      jobage,
      dates: flags.dates === true,
      page: page ?? 1,
      all: flags.all === true,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires an <id|slug|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) return fail(`--format must be one of json|plain, got "${fmt}"`, "BAD_ARG")
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  return fail(`Unknown command "${cmd}"`, "BAD_CMD")
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })
