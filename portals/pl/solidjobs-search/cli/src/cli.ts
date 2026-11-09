#!/usr/bin/env bun
// Self-contained CLI for searching job offers on SOLID.Jobs (Poland) through the
// portal's official public REST API. No external CLI framework and zero runtime
// dependencies, so it runs anywhere `bun` is available.
//
// The API is free, needs no key, and is published for aggregators and AI agents
// (https://solid.jobs/api-ofert-pracy). Limit: 300 requests/minute per IP.

import { runSearch, PAGE_SIZE, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { DIVISIONS, EXPERIENCES, writeError } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", d: "division" }
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

const HELP = `solidjobs-cli — search job offers on SOLID.Jobs (Poland) via its public API

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>       Full-text search (title, technology, skill). Recommended.
  --location, -l <cities>  Comma-separated Polish cities, e.g. "Warszawa,Kraków".
  --division, -d <name>    ${DIVISIONS.join(" | ")}. Default IT.
  --experience <levels>    Comma-separated: ${EXPERIENCES.join(", ")}.
  --category <name>        Main category, e.g. Developer, Architect, DevOps.
  --subcategory <name>     Subcategory, e.g. PHP, Python, Java, DotNet.
  --min-salary <n>         Lower salary bound >= n (PLN).
  --remote <mode>          remote | hybrid | onsite (client-side filter).
  --jobage <days>          Published within N days (client-side filter).
  --page <n>               1-indexed page of ${PAGE_SIZE} offers, newest first. Default 1.
  --all                    Sweep pages until a short/last page or, with --jobage, a page
                           reaching older offers (hard cap: 10 pages). Conflicts with
                           --page. A capped sweep sets meta.truncated (PAGE_CAP_REACHED).
  --limit, -n <n>          Cap results emitted (client-side).
  --format <fmt>           json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "php" --experience Senior --format table
  bun run src/cli.ts search -q "symfony" --remote remote --jobage 14 --format table
  bun run src/cli.ts search --subcategory PHP --min-salary 20000 --format table
  bun run src/cli.ts search -q "architekt" -l "Gdańsk,Szczecin" --format table
  bun run src/cli.ts detail xaev3a3s --format plain
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "location", "division", "experience", "category", "subcategory", "min-salary",
    "remote", "jobage", "page", "all", "limit", "format", "help", "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

const FORMATS = ["json", "table", "plain"]

function intFlag(name: string, raw: string | boolean | string[], min: number): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < min) {
    writeError(`--${name} must be a whole number of at least ${min}, got "${raw}"`, "BAD_ARG")
    return null
  }
  return val
}

function textFlag(flags: Flags, name: string): string | undefined | null {
  const v = flags[name]
  if (v === undefined) return undefined
  if (typeof v !== "string" || v.trim() === "") {
    writeError(`--${name} needs a value`, "BAD_ARG")
    return null
  }
  return v.trim()
}

/** Case-insensitive match against an allowed list, returning the canonical spelling. */
function canonical(value: string, allowed: string[]): string | undefined {
  return allowed.find((a) => a.toLowerCase() === value.toLowerCase())
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Unknown flags are rejected, never silently dropped: a discarded filter
  // changes what the search returns with no error.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      writeError(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
      return 1
    }
  }

  // Extra positionals are never silently ignored: `search PHP Symfony` would
  // otherwise search with no keywords at all.
  const positionals = flags._ as string[]
  if (cmd === "search" && positionals.length > 1) {
    writeError(`unexpected argument "${positionals[1]}" - search takes only flags; pass keywords with -q "<text>"`, "BAD_ARG")
    return 1
  }
  if (cmd === "detail" && positionals.length > 2) {
    writeError(`unexpected argument "${positionals[2]}" - detail takes a single <id|url>`, "BAD_ARG")
    return 1
  }

  const fmt = flags.format === undefined ? "json" : flags.format
  if (typeof fmt !== "string" || !FORMATS.includes(fmt) || (cmd === "detail" && fmt === "table")) {
    writeError(`--format must be ${cmd === "detail" ? "json or plain" : "json, table or plain"}, got "${fmt}"`, "BAD_ARG")
    return 1
  }

  if (cmd === "search") {
    const text: Record<string, string | undefined> = {}
    for (const name of ["query", "location", "division", "experience", "category", "subcategory", "remote"]) {
      const v = textFlag(flags, name)
      if (v === null) return 1
      text[name] = v
    }

    const division = text.division ? canonical(text.division, DIVISIONS) : "IT"
    if (!division) {
      writeError(`--division must be one of ${DIVISIONS.join(", ")}, got "${text.division}"`, "BAD_ARG")
      return 1
    }

    let experience: string[] | undefined
    if (text.experience) {
      experience = []
      for (const part of text.experience.split(",").map((s) => s.trim()).filter(Boolean)) {
        const c = canonical(part, EXPERIENCES)
        if (!c) {
          writeError(`--experience values must be from ${EXPERIENCES.join(", ")}, got "${part}"`, "BAD_ARG")
          return 1
        }
        experience.push(c)
      }
    }

    let remote: SearchOpts["remote"]
    if (text.remote) {
      const r = text.remote.toLowerCase().replace("on-site", "onsite")
      if (r !== "remote" && r !== "hybrid" && r !== "onsite") {
        writeError(`--remote must be remote, hybrid or onsite, got "${text.remote}"`, "BAD_ARG")
        return 1
      }
      remote = r
    }

    if (flags.all !== undefined && flags.all !== true) {
      writeError("--all takes no value", "BAD_ARG")
      return 1
    }
    if (flags.all === true && flags.page !== undefined) {
      writeError("--all sweeps every page from the first; it cannot be combined with --page", "CONFLICTING_PAGE_FLAGS")
      return 1
    }

    const nums: Record<string, number | undefined> = {}
    for (const [name, min] of [["jobage", 1], ["page", 1], ["limit", 1], ["min-salary", 0]] as const) {
      if (flags[name] === undefined) continue
      const v = intFlag(name, flags[name], min)
      if (v === null) return 1
      nums[name] = v
    }

    const opts: SearchOpts = {
      division,
      query: text.query,
      location: text.location,
      experience,
      category: text.category,
      subcategory: text.subcategory,
      minSalary: nums["min-salary"],
      remote,
      jobage: nums.jobage,
      page: nums.page ?? 1,
      all: flags.all === true,
      limit: nums.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      writeError("detail requires an <id|url>", "NO_ID")
      return 1
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  writeError(`Unknown command "${cmd}"`, "BAD_CMD")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
