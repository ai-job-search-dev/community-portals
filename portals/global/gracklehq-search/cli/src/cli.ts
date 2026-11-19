#!/usr/bin/env bun
// Self-contained CLI for searching games-industry jobs aggregated by Grackle HQ.
// No external CLI framework and zero runtime dependencies, so it runs anywhere
// `bun` is available.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", l: "location", d: "department", n: "limit" }

/**
 * After --query only, a single-dash word that is not one of this CLI's flags is
 * the value: `-q -mobile` passes the text "-mobile" on as the query, and the
 * Query syntax line in SKILL.md says what this board makes of it. Everywhere
 * else a token starting with "-" is a flag, so a typo like `-q --categorie` or
 * `-l -worldwide` is still rejected as an unknown flag. A negative number
 * (`--page -1`) is always a value, so the number check can report it.
 */
function isQueryValue(key: string, token: string): boolean {
  if (key !== "query" || !/^-[^-]/.test(token)) return false
  const raw = token.split("=")[0].slice(1)
  const name = Object.hasOwn(ALIAS, raw) ? ALIAS[raw] : raw
  return !Object.values(KNOWN_FLAGS).some((set) => set.has(name))
}

function parseFlags(argv: string[]): Flags {
  // No prototype: a user-supplied key like "__proto__" becomes an own property,
  // so the unknown-flag check sees it.
  const flags = Object.create(null) as Flags
  flags._ = []
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
      const isValue = !next?.startsWith("-") || /^-\d/.test(next) || isQueryValue(key, next)
      if (BOOLEAN_FLAGS.has(key) || next === undefined || !isValue) {
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

const HELP = `gracklehq-cli — search games-industry jobs aggregated by Grackle HQ from studio careers pages

USAGE
  bun run src/cli.ts search [--query <text>] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>        Matched by the board as one substring of the job title, so
                            "unity developer" works like an exact phrase. Quotes are dropped.
  --location, -l <text>     "Remote", or a country as the board names it ("USA", "UK",
                            "Canada", "Uruguay").
  --department, -d <text>   Engineering, Art, Design, Production, Quality Assurance, ...
  --jobage <days>           Seen within N days (client-side). Without --page, reads up to
                            5 pages while results are still inside the window.
  --page <n>                1-indexed page (30 results/page). Default 1.
  --limit, -n <n>           Cap results emitted (client-side).
  --format <fmt>            json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q unity -l Remote --format table
  bun run src/cli.ts search -d Engineering -l Remote --jobage 14 --format table
  bun run src/cli.ts search -q "gameplay programmer" --jobage 14
  bun run src/cli.ts detail 384925 --format plain
`

const BOOLEAN_FLAGS = new Set(["help", "h"])

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "department", "jobage", "page", "limit", "format", "help", "h"]),
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
    // An explicit --help is a success; only a bare invocation is an error.
    if (cmd || flags.help || flags.h) return 0
    return badArg("no command given - use search or detail; see the usage above", "NO_COMMAND")
  }

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
    for (const name of ["query", "location", "department"]) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !(flags[name] as string).trim())) {
        return badArg(`--${name} requires a non-empty value`)
      }
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return badArg(`--format must be one of json|table|plain, got "${fmt}"`)
    const nums: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] === undefined) continue
      const v = wholeNumber(name, flags[name])
      if (v === null) return 1
      nums[name] = v
    }
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      department: typeof flags.department === "string" ? flags.department.trim() : undefined,
      jobage: nums.jobage,
      page: nums.page,
      limit: nums.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return badArg("detail requires an <id|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) return badArg(`--format must be one of json|plain, got "${fmt}"`)
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
