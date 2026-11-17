#!/usr/bin/env bun
// Self-contained CLI for searching indie game studio jobs in Work With Indies'
// public RSS feed. Feed only: the board's terms forbid scraping its pages. No
// external CLI framework and zero runtime dependencies.

import { CATEGORIES } from "./helpers.js"

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
    const a = argv[i]
    if (a.startsWith("-")) {
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

const HELP = `workwithindies-cli — search indie game studio jobs in Work With Indies' RSS feed (mostly remote)

USAGE
  bun run src/cli.ts search [--query <text>] [flags]
  bun run src/cli.ts detail <slug|url> [--format json|plain]

The feed holds the newest 100 postings (about 6-8 weeks). detail returns the feed entry
(summary and tags); the full description is on the posting page, which is not fetched.

SEARCH FLAGS
  --query, -q <text>      Keywords, matched client-side over title, company, location, summary
                          and tags: every word must appear, "a phrase" must appear as written,
                          -word must not appear. Case-insensitive, anchored to word starts.
  --category, -c <slug>   Only postings tagged with this category:
                          ${Object.keys(CATEGORIES).join(", ")}.
  --location, -l <text>   Substring of where the job can be done from: "Anywhere", "Europe",
                          "PT", "Copenhagen".
  --jobage <days>         Posted within N days.
  --page <n>              1-indexed page of the filtered list (25 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q unity --jobage 14 --format table
  bun run src/cli.ts search -c programming --format table
  bun run src/cli.ts search -q "gameplay -senior" -l Anywhere --format table
  bun run src/cli.ts detail creature-unity-gameplay-tools-programmer --format plain
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases first). "help"/"h" pass so `search --help` still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "category", "location", "jobage", "page", "limit", "format", "help", "h"]),
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
    return cmd ? 0 : 1
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error.
  const known = KNOWN_FLAGS[cmd]
  if (known) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || known.has(key)) continue
      return badArg(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
    }
  }

  if (cmd === "search") {
    for (const name of ["query", "category", "location"]) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !(flags[name] as string).trim())) {
        return badArg(`--${name} requires a non-empty value`)
      }
    }
    const category = typeof flags.category === "string" ? flags.category.trim().toLowerCase() : undefined
    if (category && !(category in CATEGORIES)) {
      return badArg(`--category must be one of ${Object.keys(CATEGORIES).join("|")}, got "${category}"`)
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return badArg(`--format must be one of json|table|plain, got "${fmt}"`)
    }
    const nums: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
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
      page: nums.page ?? 1,
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

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })
