#!/usr/bin/env bun
// Self-contained CLI for searching Rippling's public job-board API.
// No external CLI framework and zero runtime dependencies, so it runs anywhere
// `bun` is available with nothing installed beyond the repo clone.
//
// Reads are public (no API key), but they hit an undocumented board API on
// ats.rippling.com — a vendor endpoint that may change without notice.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { API_ORIGIN, parseTerms, parseWorkplaceFlag } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

// Short-flag aliases. Null prototype: an alias-looking name such as
// "--constructor" must fall through to its own text, not to Object.prototype.
const ALIAS: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  q: "query",
  n: "limit",
  b: "board",
})

/** Parse argv; `repeated` names the first flag given more than once (aliases count as the same flag). */
function parseFlags(argv: string[]): { flags: Flags; repeated: string | null } {
  // Null prototype: a flag named like an Object.prototype member (e.g. --__proto__)
  // becomes an ordinary key that the unknown-flag check then rejects.
  const flags: Flags = Object.assign(Object.create(null) as Flags, { _: [] as string[] })
  let repeated: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("-")) {
      ;(flags._ as string[]).push(arg)
      continue
    }
    const key = ALIAS[arg.replace(/^-+/, "")] ?? arg.replace(/^-+/, "")
    if (repeated === null && Object.hasOwn(flags, key)) repeated = key
    const next = argv[i + 1]
    // A flag with no following value (or another flag next) is a boolean. A
    // negative number is a value, so `--page -1` gets the clear BAD_ARG below
    // rather than being read as an unknown flag named "1".
    let value: string | boolean = true
    if (next !== undefined && (!next.startsWith("-") || /^-\d+$/.test(next))) {
      value = next
      i++
    }
    flags[key] = value
  }
  return { flags, repeated }
}

const HELP = `rippling-cli — search a company's Rippling job board

Rippling hosts one public job board per company at
https://ats.rippling.com/<slug>/jobs. Pass that <slug> with --board.

USAGE
  bun run src/cli.ts search --board <slug|url> [-q "<keywords>"] [--format json|table|plain]
  bun run src/cli.ts detail <slug/id|url> [--board <slug>] [--format json|plain]

SEARCH FLAGS
  --board, -b <slug|url>  Required. The board slug (e.g. rippling) or its
                          https://ats.rippling.com/<slug>/jobs URL.
  --query, -q <text>      Optional keywords; every word must appear in the
                          title, department or location. Quotes are ignored
                          (a quoted phrase matches its words in any order).
  --page <n>              1-indexed page of the filtered results. Default 1.
  --limit, -n <n>         Results per page. Default 25.
  --jobage <days>         Accepted for contract compatibility, but Rippling's
                          board API exposes no posting date, so it is ignored
                          with a warning on stderr.
  --remote <modes>        Only postings whose workplace type matches: remote |
                          hybrid | onsite (comma = OR). A bare --remote means
                          remote; "on-site" is accepted for onsite. A posting
                          matches if any of its locations has the type.
  --format <fmt>          json (default) | table | plain.

DETAIL
  <slug/id|url>           The id from a search result (e.g.
                          "rippling/84d388b6-...") or a full posting URL.
  --board, -b <slug>      Board slug, needed only when <slug/id> is a bare id.
  --format <fmt>          json (default) | plain.

EXAMPLES
  bun run src/cli.ts search --board rippling --query "engineer" --limit 10 --format table
  bun run src/cli.ts search --board https://ats.rippling.com/rippling/jobs --format table
  bun run src/cli.ts detail rippling/84d388b6-7656-434c-8862-0312eb6b97ac --format plain

Reads are public (no API key). Source: ${API_ORIGIN} — an undocumented vendor
endpoint, used best-effort.
`

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  const value = typeof raw === "string" ? Number(raw.trim()) : NaN
  // Safe integers only: above 2^53 a value like 1e21 passes Number.isInteger
  // but stringifies to exponent form, and parseInt("1e+21") silently becomes 1.
  if (!Number.isSafeInteger(value) || value < 1) {
    process.stderr.write(
      JSON.stringify({
        error: `--${name} must be a whole number of at least 1, got "${raw}"`,
        code: "BAD_ARG",
      }) + "\n",
    )
    return null
  }
  return value
}

// Long-form flag names each command accepts. "help"/"h" pass so
// `search --help` still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["board", "query", "jobage", "page", "limit", "remote", "format", "help", "h"]),
  detail: new Set(["board", "format", "help", "h"]),
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const { flags, repeated } = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error. The portal contract
  // requires a bogus flag to exit 1 with a JSON error on stderr.
  // Object.hasOwn: KNOWN_FLAGS[cmd] would otherwise resolve inherited keys, so
  // a command named "constructor"/"__proto__" reached `.has` on a non-Set.
  const knownFlags = Object.hasOwn(KNOWN_FLAGS, cmd) ? KNOWN_FLAGS[cmd] : undefined
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

  // A repeated flag would otherwise keep only its last value.
  if (repeated) {
    process.stderr.write(
      JSON.stringify({ error: `--${repeated} was given more than once; pass it once`, code: "BAD_ARG" }) + "\n",
    )
    return 1
  }

  const extra = (flags._ as string[]).slice(cmd === "detail" ? 2 : 1)
  if (extra.length > 0) {
    process.stderr.write(
      JSON.stringify({ error: `unexpected argument "${extra[0]}" for '${cmd}'; see --help`, code: "BAD_ARG" }) + "\n",
    )
    return 1
  }

  // These options take values; treating a present-but-empty one as unset
  // silently broadens the search.
  for (const name of ["board", "query"]) {
    const value = flags[name]
    if (value !== undefined && (typeof value !== "string" || !value.trim())) {
      process.stderr.write(
        JSON.stringify({ error: `--${name} requires a non-empty value`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    if (flags.board === undefined) {
      process.stderr.write(
        JSON.stringify({
          error:
            'the --board/-b flag is required, the Rippling board to read — e.g. -b rippling, or the https://ats.rippling.com/<slug>/jobs URL',
          code: "NO_BOARD",
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

    const numbers: { jobage?: number; page?: number; limit?: number } = {}
    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const value = parseIntFlag(name, flags[name])
        if (value === null) return 1
        numbers[name] = value
      }
    }

    const workplace = parseWorkplaceFlag(flags.remote)
    if (workplace.bad !== undefined) {
      process.stderr.write(
        JSON.stringify({
          error: `--remote must be remote, hybrid or onsite (or on-site); comma-separate for OR, got "${workplace.bad}"`,
          code: "BAD_ARG",
        }) + "\n",
      )
      return 1
    }

    // "-q '\"\"'" passes the non-empty check but parseTerms strips the quotes,
    // so the search would run unfiltered. Require at least one real term.
    if (typeof flags.query === "string" && parseTerms(flags.query).length === 0) {
      process.stderr.write(
        JSON.stringify({
          error: `--query must contain at least one search term, got "${flags.query}"`,
          code: "BAD_ARG",
        }) + "\n",
      )
      return 1
    }

    const opts: SearchOpts = {
      board: flags.board as string,
      query: typeof flags.query === "string" ? flags.query : undefined,
      jobage: numbers.jobage,
      page: numbers.page ?? 1,
      limit: numbers.limit ?? 25,
      workplace: workplace.modes,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const ref = (flags._ as string[])[1]
    if (!ref) {
      process.stderr.write(
        JSON.stringify({
          error: 'detail requires a <slug/id|url> or a bare posting id with --board <slug>',
          code: "NO_ID",
        }) + "\n",
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
    const opts: DetailOpts = {
      ref,
      board: typeof flags.board === "string" ? flags.board : undefined,
      format: fmt as DetailOpts["format"],
    }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => {
    // Let the event loop flush stdout before exiting: process.exit() can cut a
    // large JSON result off mid-write when stdout is a pipe.
    process.exitCode = code
  })
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exitCode = 1
  })
