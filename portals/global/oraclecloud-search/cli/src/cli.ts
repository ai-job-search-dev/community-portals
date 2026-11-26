#!/usr/bin/env bun
// Self-contained CLI for any employer's Oracle Recruiting Cloud (ORC) careers
// site, through the public recruitingCEJobRequisitions REST API. No external CLI
// framework and zero runtime dependencies, so it runs anywhere `bun` is
// available with nothing installed beyond the repo clone. ORC has no global
// index: every search names a board.

import { parseBoard } from "./board.js"
import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail } from "./commands/detail.js"

interface Flags {
  [key: string]: string | boolean
}

// Short-flag aliases.
const ALIAS: Record<string, string> = { q: "query", l: "location", b: "board", n: "limit" }

interface ParsedFlags {
  flags: Flags
  positional: string[]
  repeated: string[]
}

function parseFlags(argv: string[]): ParsedFlags {
  // Null prototype: a flag named like an Object.prototype member (--__proto__)
  // becomes an ordinary key that the unknown-flag check then rejects.
  const flags: Flags = Object.create(null) as Flags
  const positional: string[] = []
  const repeated: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("-")) {
      positional.push(arg)
      continue
    }
    const name = arg.replace(/^-+/, "")
    const key = Object.hasOwn(ALIAS, name) ? ALIAS[name] : name
    const next = argv[i + 1]
    // A flag with no following value (or another flag next) is a boolean; the
    // value-taking flags reject that below instead of silently using a default.
    let value: string | boolean = true
    if (next !== undefined && !next.startsWith("-")) {
      value = next
      i++
    }
    if (flags[key] !== undefined) repeated.push(key)
    flags[key] = value
  }
  return { flags, positional, repeated }
}

function stringFlag(raw: string | boolean | undefined): string | undefined {
  return typeof raw === "string" ? raw : undefined
}

const HELP = `oraclecloud-cli - search any employer's Oracle Recruiting Cloud careers site

USAGE
  bun run src/cli.ts search --board <board> [--query "<text>"] [flags]
  bun run src/cli.ts detail <job-url> [--format json|plain]

BOARD (required for search)
  --board, -b <board>   The employer's ORC careers site, as its careers URL
                        https://<host>/hcmUI/CandidateExperience/<lang>/sites/<site>/jobs
                        or <host>/<site> (language defaults to en), e.g.
                        jpmc.fa.oraclecloud.com/CX_1001.
                        ORC has no global index, so a board is always named.

SEARCH FLAGS
  --query, -q <text>    Keywords, passed to the board's own search. Optional:
                        without it the board lists its newest postings.
  --location, -l <text> Case-insensitive substring match on the location string,
                        applied to the page fetched (the API's own location
                        filter uses per-board numeric ids).
  --location-id <id>    Optional numeric ORC location id for the few tenants
                        that need one to scope results. Leave unset normally.
  --page <n>            1-indexed page, 20 results per page. Default 1.
  --jobage <days>       Keep postings dated within N days. Sent to the board as
                        postingStartDate and also applied to the returned page;
                        undated postings are dropped.
  --limit, -n <n>       Cap the results this call prints (client-side).
  --format <fmt>        json (default) | table | plain.

DETAIL
  <job-url>             A posting URL from a search result's id/url.

EXAMPLES
  bun run src/cli.ts search -b jpmc.fa.oraclecloud.com/CX_1001 -q "software engineer" --format table
  bun run src/cli.ts search -b "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs" -l "New York" --jobage 14
  bun run src/cli.ts detail "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210675973"

Reads are public (no API key). Only the named board's ORC REST endpoints are
requested. Keep volume low: this is a personal-use search tool.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "board",
    "query",
    "location",
    "location-id",
    "page",
    "jobage",
    "limit",
    "format",
    "help",
    "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

function positiveInt(name: string, raw: string | boolean): number | null {
  const value = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isSafeInteger(value) || value < 1) {
    process.stderr.write(
      JSON.stringify({
        error: `--${name} must be a whole number of at least 1, got "${String(raw)}"`,
        code: "BAD_ARG",
      }) + "\n",
    )
    return null
  }
  return value
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const { flags, positional, repeated } = parseFlags(argv)
  const command = positional[0]

  if (!command || flags.help || flags.h) {
    process.stdout.write(HELP)
    return command ? 0 : 1
  }

  const known = Object.hasOwn(KNOWN_FLAGS, command) ? KNOWN_FLAGS[command] : undefined
  if (!known) return fail(`unknown command "${command}"; see --help`, "BAD_CMD")

  for (const key of Object.keys(flags)) {
    if (known.has(key)) continue
    return fail(
      `unknown flag --${key} for '${command}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
      "UNKNOWN_FLAG",
    )
  }

  // Every option this CLI declares is single-value. Taking the last occurrence
  // silently would let `-q engineer --query manager` search only one of them.
  if (repeated.length > 0) {
    return fail(
      `option --${repeated[0]} was given more than once; every option is single-value, so pass it once with the value you mean`,
      "BAD_ARG",
    )
  }

  const extra = positional.slice(command === "detail" ? 2 : 1)
  if (extra.length > 0) {
    return fail(`unexpected argument "${extra[0]}" for '${command}'; see --help`, "BAD_ARG")
  }

  const format = flags.format !== undefined ? String(flags.format) : "json"
  const formats = command === "search" ? ["json", "table", "plain"] : ["json", "plain"]
  if (!formats.includes(format)) {
    return fail(`--format must be one of ${formats.join("|")}, got "${format}"`, "BAD_ARG")
  }

  if (command === "search") {
    const boardArg = stringFlag(flags.board)
    if (!boardArg || !boardArg.trim()) {
      return fail(
        "--board is required: Oracle Recruiting Cloud has no global index. Pass the employer's careers URL or <host>/<site>, e.g. --board https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs",
        "MISSING_REQUIRED",
      )
    }
    const board = parseBoard(boardArg)
    if (!board) {
      return fail(
        `could not parse an Oracle Recruiting Cloud board from "${boardArg}" - expected https://<host>/hcmUI/CandidateExperience/<lang>/sites/<site>/jobs or <host>/<site>`,
        "BAD_BOARD",
      )
    }

    if (flags.query !== undefined && (typeof flags.query !== "string" || !flags.query.trim())) {
      return fail("--query was given but is empty; omit it to list all postings", "BAD_ARG")
    }
    const query = stringFlag(flags.query)
    // The keyword rides inside ORC's finder grammar, where ',' and ';' are its
    // own separators. Passing one through would silently search a different set.
    if (query && /[;,\u0000-\u001F\u007F-\u009F]/.test(query)) {
      return fail(
        "--query cannot contain commas, semicolons or control characters: the board's finder grammar uses them as separators; search one plain term per call",
        "BAD_ARG",
      )
    }

    if (flags.location !== undefined && (typeof flags.location !== "string" || !flags.location.trim())) {
      return fail("--location was given but is empty; omit it to keep every location", "BAD_ARG")
    }

    if (flags["location-id"] !== undefined) {
      const raw = flags["location-id"]
      if (typeof raw !== "string" || !/^\d{1,20}$/.test(raw.trim())) {
        return fail(
          `--location-id must be a numeric ORC location id, got "${String(raw)}"`,
          "BAD_ARG",
        )
      }
    }
    const locationId = stringFlag(flags["location-id"])?.trim()

    let page = 1
    let jobage: number | undefined
    let limit: number | undefined
    for (const name of ["page", "jobage", "limit"] as const) {
      if (flags[name] === undefined) continue
      const value = positiveInt(name, flags[name])
      if (value === null) return 1
      if (name === "page") page = value
      else if (name === "jobage") jobage = value
      else limit = value
    }

    // A job cannot be older than this, and a bigger number overflows Date
    // arithmetic. Reject it as an argument instead of crashing later.
    if (jobage !== undefined && jobage > 36_500) {
      return fail("--jobage must be at most 36500 days", "BAD_ARG")
    }

    const opts: SearchOpts = {
      board,
      query,
      location: stringFlag(flags.location)?.trim(),
      locationId,
      page,
      jobage,
      limit,
      format: format as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  const id = positional[1]
  if (!id) return fail("detail requires a <job-url>", "MISSING_REQUIRED")
  return runDetail(id, format as "json" | "plain")
}

main()
  // Set the exit code instead of calling process.exit(): Bun truncates piped
  // stdout at 128 KiB when the process exits immediately after a write, which
  // would cut a long detail description. Natural exit flushes it.
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    process.stderr.write(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exitCode = 1
  })
