#!/usr/bin/env bun
// publicjobs-cli: search publicjobs.ch, the Swiss job board of cantons,
// municipalities, public schools, hospitals and non-profits. Reads the public
// sitemap and per-posting __data.json payloads; zero runtime dependencies.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit", l: "location", c: "category" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      const value: string | boolean = next === undefined || next.startsWith("-") ? true : next
      if (value !== true) i++
      flags[key] = value
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `publicjobs-cli — publicjobs.ch (Swiss public-sector and non-profit jobs)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Client-side filter on the posting's URL title slug: every word must
                          appear (case/umlaut-insensitive substring); "double quotes" make a phrase.
                          Optional: without it, every open posting.
  --location, -l <canton> Canton name, code or slug (Zürich, ZH, zuerich). Client-side.
  --category, -c <text>   Category label or slug substring (informatik, "Finanzen"). Client-side.
  --page <n>              1-indexed page of the results, highest (newest) id first, 20 per page.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

  There is no --jobage: the sitemap carries no posting date. Use detail for the date.

EXAMPLES
  bun run src/cli.ts search -q "data" --format table
  bun run src/cli.ts search -q statistik -l SZ
  bun run src/cli.ts search -c informatik -l zuerich --format table
  bun run src/cli.ts detail 168023 --format plain

The sitemap is cached for 30 minutes (PUBLICJOBS_CACHE_TTL seconds, 0 disables).
Keep volume low.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "category", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

function parsePositive(raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  return Number.isInteger(val) && val >= 1 ? val : null
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      if (cmd === "search" && key === "jobage") {
        return fail(
          "--jobage is not supported: the publicjobs.ch sitemap carries no posting date, so a recency filter would silently pass or drop postings at random; filter on detail's `date` instead",
          "UNSUPPORTED_FLAG",
        )
      }
      return fail(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
    }
  }

  if (cmd === "search") {
    for (const name of ["query", "location", "category"]) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !String(flags[name]).trim())) {
        return fail(`--${name} requires a non-empty value`, "BAD_ARG")
      }
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")

    const nums: Record<string, number | undefined> = {}
    for (const name of ["page", "limit"]) {
      if (flags[name] === undefined) continue
      const v = parsePositive(flags[name])
      if (v === null) return fail(`--${name} must be a whole number of at least 1, got "${flags[name]}"`, "BAD_ARG")
      nums[name] = v
    }

    const text = (k: string) => (typeof flags[k] === "string" ? String(flags[k]).trim() : undefined)
    const opts: SearchOpts = {
      query: text("query"),
      location: text("location"),
      category: text("category"),
      page: nums.page ?? 1,
      limit: nums.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires an <id|url>", "NO_ID")
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
