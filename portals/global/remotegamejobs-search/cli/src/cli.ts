#!/usr/bin/env bun
// Self-contained CLI for searching remote-only games-industry jobs on Remote
// Game Jobs' public search, category and posting pages. No external CLI
// framework and zero runtime dependencies. Personal, non-commercial use: the
// board's terms license its content for that use only.

import { CATEGORIES } from "./helpers.js"

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", l: "location", n: "limit", c: "category" }

/** A token is a flag only when it names one this CLI knows; "-mobile" after -q is a value. */
function isFlagToken(token: string): boolean {
  if (!token.startsWith("-") || token.length < 2) return false
  const raw = token.split("=")[0].replace(/^-+/, "")
  const key = Object.hasOwn(ALIAS, raw) ? ALIAS[raw] : raw
  return Object.values(KNOWN_FLAGS).some((set) => set.has(key))
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-") && a.length > 1) {
      const eq = a.indexOf("=")
      const raw = (eq > 0 ? a.slice(0, eq) : a).replace(/^-+/, "")
      const key = Object.hasOwn(ALIAS, raw) ? ALIAS[raw] : raw
      if (eq > 0) {
        flags[key] = a.slice(eq + 1)
        continue
      }
      const next = argv[i + 1]
      if (BOOLEAN_FLAGS.has(key) || next === undefined || isFlagToken(next)) {
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

const HELP = `remotegamejobs-cli — search remote-only games-industry jobs on Remote Game Jobs

Personal, non-commercial use only (the board's terms). Keep volume low.

USAGE
  bun run src/cli.ts search [--query <text>] [flags]
  bun run src/cli.ts detail <slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords, searched server-side in the full posting text. Quotes are
                          ignored; every word must match. Recommended.
  --category, -c <slug>   Only one category: ${Object.keys(CATEGORIES).join(", ")}.
  --location, -l <text>   Substring of the posting's remote scope: "worldwide", "europe",
                          "canada", "utc".
  --jobage <days>         Posted within N days (dates come from the RSS feed; postings older
                          than the feed are undated and kept).
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

Every match is returned on one page (the board is small), so there is no --page.

EXAMPLES
  bun run src/cli.ts search -q unity --format table
  bun run src/cli.ts search -c programming --format table
  bun run src/cli.ts search -q "gameplay programmer" -l worldwide --format table
  bun run src/cli.ts detail skymap-games-multiplayer-engineer-unity-remote-job --format plain
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases first). "help"/"h" pass so `search --help` still prints usage.
const BOOLEAN_FLAGS = new Set(["help", "h"])

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "category", "location", "jobage", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function badArg(error: string, code = "BAD_ARG"): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

function wholeNumber(name: string, raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    badArg(`--${name} must be a whole number of at least 1, got "${raw}"`)
    return null
  }
  return val
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    if (cmd) return 0
    return badArg("no command given - use search or detail; see the usage above", "NO_COMMAND")
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error.
  const known = Object.hasOwn(KNOWN_FLAGS, cmd) ? KNOWN_FLAGS[cmd] : undefined
  if (known) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || known.has(key)) continue
      return badArg(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
    }
  }
  // Leftover words are rejected too: `search unity` (no -q) or an unquoted
  // second query word would otherwise be dropped and change the results.
  const extra = (flags._ as string[]).slice(cmd === "detail" ? 2 : 1)
  if (known && extra.length > 0) {
    return badArg(
      `unexpected argument "${extra[0]}" for '${cmd}' - quote multi-word values, e.g. -q "unity developer"; see --help`,
    )
  }


  if (cmd === "search") {
    for (const name of ["query", "category", "location"]) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !(flags[name] as string).trim())) {
        return badArg(`--${name} requires a non-empty value`)
      }
    }
    const category = typeof flags.category === "string" ? flags.category.trim().toLowerCase() : undefined
    if (category && !Object.hasOwn(CATEGORIES, category)) {
      return badArg(`--category must be one of ${Object.keys(CATEGORIES).join("|")}, got "${category}"`)
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return badArg(`--format must be one of json|table|plain, got "${fmt}"`)
    }
    const nums: Record<string, number | undefined> = {}
    for (const name of ["jobage", "limit"]) {
      if (flags[name] === undefined) continue
      const v = wholeNumber(name, flags[name])
      if (v === null) return 1
      nums[name] = v
    }
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      category,
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      jobage: nums.jobage,
      limit: nums.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return badArg("detail requires a <slug|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) {
      return badArg(`--format must be one of json|plain, got "${fmt}"`)
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  return badArg(`Unknown command "${cmd}"`, "BAD_CMD")
}

// exitCode, not process.exit(): exiting immediately can cut off stdout that is
// still being written to a pipe.
main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exitCode = 1
  })
