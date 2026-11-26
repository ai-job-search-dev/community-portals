#!/usr/bin/env bun
// Self-contained CLI for searching Editx.eu, a Belgian IT job board, through
// the JSON API behind the site's own job search. Zero runtime dependencies.
//
// Personal use only: Editx's Terms of Use (section 3.3) list "Use scraping or
// similar techniques, to collect content" among things users agree not to do.
// Keep volume low; see SKILL.md.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

type FlagValue = string | true

interface Parsed {
  positionals: string[]
  flags: Record<string, FlagValue>
  repeated?: string // the first flag given twice; rejected rather than last-wins
  dashValue?: { flag: string; value: string } // a value flag followed by a dash token
}

const ALIAS: Record<string, string> = { q: "query", l: "location", n: "limit", h: "help" }

// Flags that take a value. A value-taking flag at the end of argv, or followed
// by another flag, is recorded as `true` so validation can reject it instead of
// silently dropping the filter.
const VALUE_FLAGS = new Set(["query", "location", "jobage", "page", "limit", "format"])

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "page", "limit", "format", "help"]),
  detail: new Set(["format", "help"]),
}

function parseArgv(argv: string[]): Parsed {
  // A null prototype, so a flag named like an Object.prototype key
  // (--__proto__, --constructor) is an ordinary unknown flag, not a no-op.
  const parsed: Parsed = { positionals: [], flags: Object.create(null) as Record<string, FlagValue> }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("-") || arg === "-") {
      parsed.positionals.push(arg)
      continue
    }
    let name = arg.replace(/^-+/, "")
    let inline: string | undefined
    const eq = name.indexOf("=")
    if (eq >= 0) {
      inline = name.slice(eq + 1)
      name = name.slice(0, eq)
    }
    // Own properties only: ALIAS["__proto__"] would otherwise return Object.prototype.
    const key = Object.hasOwn(ALIAS, name) ? ALIAS[name] : name
    if (key in parsed.flags && parsed.repeated === undefined) parsed.repeated = key
    const next = argv[i + 1]
    if (inline !== undefined) {
      parsed.flags[key] = inline
    } else if (VALUE_FLAGS.has(key) && next !== undefined && !next.startsWith("-")) {
      parsed.flags[key] = argv[++i]
    } else {
      if (VALUE_FLAGS.has(key) && next !== undefined && next.startsWith("-") && parsed.dashValue === undefined) {
        parsed.dashValue = { flag: key, value: next }
      }
      parsed.flags[key] = true
    }
  }
  return parsed
}

const HELP = `editx-cli - search Editx.eu, a Belgian IT job board (personal use only)

USAGE
  bun run src/cli.ts search -q "<keywords>" [-l <city>] [--jobage <days>] [--page <n>] [--limit <n>] [--format json|table|plain]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords. Required. Matches postings containing any of the
                          words; quotes and OR are not operators. A value that
                          starts with "-" needs the = form: --query=-net.
  --location, -l <place>  City or province as Editx writes it, in the local language:
                          Gent, Antwerpen, Leuven, Brussels, Liège ... ("Ghent" finds nothing).
  --jobage <days>         Keep postings from the last N days, today counting as day 1.
                          Client-side: filters the fetched page only (Editx has no
                          date filter).
  --page <n>              1-indexed page; each page is a fixed block of up to 50
                          results. Default 1.
  --limit, -n <n>         Return the first N results of that page (client-side cap,
                          max 50). Default 25.
  --format <fmt>          json (default) | table | plain.

DETAIL
  <id|url>                An Editx job id (from a search result) or an
                          https://editx.eu/en/it-jobs/<id>/<slug> URL.

EXAMPLES
  bun run src/cli.ts search -q "python" -l Leuven --format table
  bun run src/cli.ts search -q "data engineer" -l Gent --jobage 30 --format table
  bun run src/cli.ts detail 20750 --format plain

Personal use only (Editx Terms of Use, section 3.3): keep volume low.
`

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

/**
 * A whole number >= 1 written as plain digits. "1.5", "3abc", "1e1", "0x2",
 * "+3" and padded values are rejected rather than coerced or truncated.
 */
function positiveInt(name: string, raw: FlagValue): number | null {
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`--${name} must be a whole number of at least 1, got "${raw === true ? "" : raw}"`, "BAD_ARG")
    return null
  }
  return value
}

function nonEmpty(name: string, raw: FlagValue | undefined): string | undefined | null {
  if (raw === undefined) return undefined
  if (typeof raw !== "string" || !raw.trim()) {
    fail(`--${name} requires a non-empty value`, "BAD_ARG")
    return null
  }
  return raw.trim()
}

async function main(): Promise<number> {
  const { positionals, flags, repeated, dashValue } = parseArgv(process.argv.slice(2))
  const cmd = positionals[0]

  if (flags.help) {
    process.stdout.write(HELP)
    return 0
  }
  if (!cmd) {
    process.stdout.write(HELP)
    return 1
  }

  // Own properties only: "constructor" or "toString" is not a command.
  if (!Object.hasOwn(KNOWN_FLAGS, cmd)) return fail(`Unknown command "${cmd}"; use search or detail`, "BAD_CMD")
  const known = KNOWN_FLAGS[cmd]

  if (dashValue && known.has(dashValue.flag)) {
    return fail(
      `--${dashValue.flag} is followed by "${dashValue.value}", which reads as a flag; write --${dashValue.flag}=${dashValue.value} if it is the value`,
      "BAD_ARG",
    )
  }
  if (repeated !== undefined && known.has(repeated)) {
    return fail(`--${repeated} was given more than once; pass it once`, "BAD_ARG")
  }

  for (const key of Object.keys(flags)) {
    if (!known.has(key)) {
      return fail(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help`,
        "UNKNOWN_FLAG",
      )
    }
  }

  const extra = positionals.slice(cmd === "detail" ? 2 : 1)
  if (extra.length > 0) return fail(`unexpected argument "${extra[0]}" for '${cmd}'; see --help`, "BAD_ARG")

  if (cmd === "search") {
    const query = nonEmpty("query", flags.query)
    if (query === null) return 1
    if (query === undefined) return fail("search requires --query <text>", "BAD_ARG")
    const location = nonEmpty("location", flags.location)
    if (location === null) return 1

    const format = flags.format === undefined ? "json" : flags.format
    if (typeof format !== "string" || !["json", "table", "plain"].includes(format)) {
      return fail(`--format must be one of json|table|plain, got "${format === true ? "" : format}"`, "BAD_ARG")
    }

    const ints: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] === undefined) continue
      const v = positiveInt(name, flags[name])
      if (v === null) return 1
      ints[name] = v
    }

    const opts: SearchOpts = {
      query,
      location,
      jobage: ints.jobage,
      page: ints.page ?? 1,
      limit: ints.limit ?? 25,
      format: format as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  const id = positionals[1]
  if (!id) return fail("detail requires an <id|url>", "NO_ID")
  const format = flags.format === undefined ? "json" : flags.format
  if (typeof format !== "string" || !["json", "plain"].includes(format)) {
    return fail(`--format must be one of json|plain, got "${format === true ? "" : format}"`, "BAD_ARG")
  }
  const opts: DetailOpts = { id, format: format as DetailOpts["format"] }
  return runDetail(opts)
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((e) => {
    process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n")
    process.exitCode = 1
  })
