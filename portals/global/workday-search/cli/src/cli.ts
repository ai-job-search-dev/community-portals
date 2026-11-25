#!/usr/bin/env bun
// Self-contained CLI for any employer's Workday job board, through Workday's
// public CXS API. No external CLI framework and zero runtime dependencies, so
// it runs anywhere `bun` is available with nothing installed beyond the repo
// clone. Workday has no global index: every search names a board.

import { parseBoard } from "./board.js"
import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail } from "./commands/detail.js"

interface Flags {
  _: string[]
  [key: string]: string | boolean | string[]
}

// Short-flag aliases.
const ALIAS: Record<string, string> = { q: "query", b: "board", n: "limit" }

interface ParsedFlags {
  flags: Flags
  repeated: string[]
}

function parseFlags(argv: string[]): ParsedFlags {
  const flags: Flags = { _: [] }
  const repeated: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("-")) {
      ;(flags._ as string[]).push(arg)
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
  return { flags, repeated }
}

function stringFlag(raw: string | boolean | string[] | undefined): string | undefined {
  return typeof raw === "string" ? raw : undefined
}

const HELP = `workday-cli - search any employer's Workday job board

USAGE
  bun run src/cli.ts search --board <board> [--query "<text>"] [flags]
  bun run src/cli.ts detail <job-url> [--format json|plain]

BOARD (required for search)
  --board, -b <board>   The employer's Workday board, as either its careers URL
                        https://<tenant>.wdN.myworkdayjobs.com/<site>
                        (an optional locale segment is fine), its
                        https://wdN.myworkdaysite.com/recruiting/<tenant>/<site>
                        form (an optional locale may precede /recruiting/), or
                        the bare <tenant>/<instance>/<site> triple,
                        e.g. nvidia/wd5/NVIDIAExternalCareerSite.
                        Workday has no global index, so a board is always named.

SEARCH FLAGS
  --query, -q <text>    Keywords (title, skill, place). Optional: without it the
                        board lists all its postings.
  --page <n>            1-indexed page, 20 results per page. Default 1.
                        Workday caps a query at 2,000 postings, so page 100 is
                        the deepest; narrow --query instead of paging past it.
  --jobage <days>       Keep postings on this page dated within N days. Workday
                        only reports relative ages ("Posted 7 Days Ago"), so
                        this is day-granular and drops "30+ Days Ago" postings.
  --limit, -n <n>       Cap the results this call prints (client-side).
  --format <fmt>        json (default) | table | plain.

DETAIL
  <job-url>             A posting URL from a search result's id/url.

EXAMPLES
  bun run src/cli.ts search -b nvidia/wd5/NVIDIAExternalCareerSite -q "software engineer" --format table
  bun run src/cli.ts search -b https://salesforce.wd12.myworkdayjobs.com/External_Career_Site -q "product manager" --jobage 7
  bun run src/cli.ts detail "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506"

Reads are public (no API key). Only the named board's /wday/cxs endpoints are
requested. Keep volume low: this is a personal-use search tool.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["board", "query", "page", "jobage", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

function positiveInt(name: string, raw: string | boolean | string[]): number | null {
  const value = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(value) || value < 1) {
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
  const { flags, repeated } = parseFlags(argv)
  const command = (flags._ as string[])[0]

  if (!command || flags.help || flags.h) {
    process.stdout.write(HELP)
    return command ? 0 : 1
  }

  const known = Object.hasOwn(KNOWN_FLAGS, command) ? KNOWN_FLAGS[command] : undefined
  if (!known) return fail(`unknown command "${command}"; see --help`, "BAD_CMD")

  for (const key of Object.keys(flags)) {
    if (key === "_" || known.has(key)) continue
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

  const extra = (flags._ as string[]).slice(command === "detail" ? 2 : 1)
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
        "--board is required: Workday has no global index. Pass the employer's careers URL or <tenant>/<instance>/<site>, e.g. --board nvidia/wd5/NVIDIAExternalCareerSite",
        "MISSING_REQUIRED",
      )
    }
    const board = parseBoard(boardArg)
    if (!board) {
      return fail(
        `could not parse a Workday board from "${boardArg}" - expected https://<tenant>.wdN.myworkdayjobs.com/<site> or <tenant>/<instance>/<site>`,
        "BAD_BOARD",
      )
    }

    if (flags.query !== undefined && (typeof flags.query !== "string" || !flags.query.trim())) {
      return fail("--query was given but is empty; omit it to list all postings", "BAD_ARG")
    }

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
      query: stringFlag(flags.query),
      page,
      jobage,
      limit,
      format: format as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  const id = (flags._ as string[])[1]
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
