#!/usr/bin/env bun
// Self-contained CLI for reading company job boards hosted on SmartRecruiters,
// via its public Posting API. No authentication, zero runtime dependencies: it
// runs anywhere `bun` is available.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { parseBoard, parseRemoteModes } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

/** Parse argv; `repeated` names the first flag given more than once (aliases count as the same flag). */
function parseFlags(argv: string[]): { flags: Flags; repeated: string | null; invalidFlag: string | null } {
  // Null prototype: a flag named like an Object.prototype member (e.g. --__proto__)
  // becomes an ordinary key that the unknown-flag check then rejects.
  const flags: Flags = Object.assign(Object.create(null) as Flags, { _: [] as string[] })
  let repeated: string | null = null
  let invalidFlag: string | null = null
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", b: "board" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-")) {
      const name = a.replace(/^-+/, "")
      const key = Object.prototype.hasOwnProperty.call(alias, name) ? alias[name] : name
      const next = argv[i + 1]
      // `_` is the positional-argument array, never a flag name.
      if (key === "_") {
        invalidFlag = invalidFlag ?? name
        if (next !== undefined && !next.startsWith("-")) i++
        continue
      }
      if (repeated === null && Object.prototype.hasOwnProperty.call(flags, key)) repeated = key
      // A query can be negative text ("-remote"); other flags take ordinary values.
      const dashValue = key === "query" && next !== undefined && next.startsWith("-") && !next.startsWith("--")
      if (next === undefined || (next.startsWith("-") && !dashValue)) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return { flags, repeated, invalidFlag }
}

const HELP = `smartrecruiters-cli — read company job boards hosted on SmartRecruiters (public Posting API)

USAGE
  bun run src/cli.ts search --board <slug> [flags]
  bun run src/cli.ts detail <url | id --board <slug>> [--format json|plain]

SEARCH FLAGS
  --board, -b <slug>      Company identifier. REQUIRED. The path segment in
                          jobs.smartrecruiters.com/<slug>/..., e.g. "BoschGroup".
                          A careers or posting URL from that host is accepted too.
  --query, -q <text>      Keywords, passed to SmartRecruiters' own search.
  --location, -l <text>   Tries the board's exact city filter first; otherwise
                          filters the fetched page (and warns). Use --city,
                          --country or --region for an explicit board-wide filter.
  --city <name>           Exact city filter (case-sensitive), applied by SmartRecruiters.
  --country <code>        ISO 3166-1 alpha-2 country filter, whole board (case-insensitive).
  --region <name>         Exact region filter (case-sensitive), applied by SmartRecruiters.
  --remote [mode]         remote | hybrid | onsite (on-site accepted). A bare
                          --remote means remote; comma = OR. Server-side, whole board.
  --jobage <days>         Released within N days (server-side, whole board).
  --page <n>              1-indexed page (20 results/page in this CLI). Default 1.
  --limit, -n <n>         Cap results emitted (client-side, on this page).
  --format <fmt>          json (default) | table | plain.

DETAIL
  Accepts a jobs.smartrecruiters.com/<slug>/<id>[-<title>] URL (the board is read
  from the URL), a careers.smartrecruiters.com URL, the API URL, or a posting id
  with --board. A bare id names no board.

EXAMPLES
  bun run src/cli.ts search -b BoschGroup -q "software engineer" --format table
  bun run src/cli.ts search -b BoschGroup --city Berlin --format table
  bun run src/cli.ts search -b BoschGroup --remote remote --format table
  bun run src/cli.ts search -b BoschGroup -q engineer -l "Penang" --jobage 14
  bun run src/cli.ts detail https://jobs.smartrecruiters.com/BoschGroup/744000163798847 --format plain
  bun run src/cli.ts detail 744000163798847 --board BoschGroup
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["board", "query", "location", "city", "country", "region", "remote", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["board", "format", "help", "h"]),
}

function fail(error: string, code = "BAD_ARG"): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

function parsePositiveInt(name: string, raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isSafeInteger(val) || val < 1) {
    fail(`--${name} must be a safe whole number of at least 1, got "${raw}"`)
    return null
  }
  return val
}

async function main(): Promise<number> {
  const { flags, repeated, invalidFlag } = parseFlags(process.argv.slice(2))
  if (invalidFlag) return fail(`unknown flag --${invalidFlag}`, "UNKNOWN_FLAG")
  const cmd = (flags._ as string[])[0]
  const helpRequested = Boolean(flags.help || flags.h)

  if (!cmd || helpRequested) {
    process.stdout.write(HELP)
    return helpRequested ? 0 : 1
  }

  const knownFlags = Object.prototype.hasOwnProperty.call(KNOWN_FLAGS, cmd) ? KNOWN_FLAGS[cmd] : undefined
  if (!knownFlags) return fail(`Unknown command "${cmd}"`, "BAD_CMD")
  for (const key of Object.keys(flags)) {
    if (key === "_" || knownFlags.has(key)) continue
    return fail(
      `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
      "UNKNOWN_FLAG",
    )
  }

  // A repeated flag would otherwise keep only its last value.
  if (repeated) return fail(`--${repeated} was given more than once; pass it once`)

  // A stray word (e.g. an unquoted multi-word --query) would otherwise be dropped silently.
  const extra = (flags._ as string[]).slice(cmd === "detail" ? 2 : 1)
  if (extra.length > 0) return fail(`unexpected argument "${extra[0]}" for '${cmd}' - quote multi-word values; see --help`)

  let board: string | undefined
  if (flags.board !== undefined) {
    if (typeof flags.board !== "string" || !parseBoard(flags.board)) {
      return fail(`--board must be a company identifier such as "BoschGroup" or a SmartRecruiters board URL, got "${flags.board}"`)
    }
    board = parseBoard(flags.board) ?? undefined
  }

  if (cmd === "search") {
    if (!board) return fail('the --board/-b flag is required (e.g. -b BoschGroup)', "NO_BOARD")
    for (const name of ["query", "location", "city", "region"] as const) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !(flags[name] as string).trim())) {
        return fail(`--${name} requires a non-empty value`)
      }
    }
    let country: string | undefined
    if (flags.country !== undefined) {
      if (typeof flags.country !== "string" || !/^[A-Za-z]{2}$/.test(flags.country.trim())) {
        return fail(`--country requires a two-letter ISO 3166-1 code, e.g. "DE", got "${flags.country}"`)
      }
      country = flags.country.trim().toLowerCase()
    }
    const parsedRemote = parseRemoteModes(flags.remote)
    if (parsedRemote.bad !== undefined) {
      return fail(`--remote must be one of remote|hybrid|onsite, got "${parsedRemote.bad}"`)
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return fail(`--format must be one of json|table|plain, got "${fmt}"`)

    const ints: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] === undefined) continue
      const v = parsePositiveInt(name, flags[name])
      if (v === null) return 1
      ints[name] = v
    }

    const opts: SearchOpts = {
      board,
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      city: typeof flags.city === "string" ? flags.city.trim() : undefined,
      country,
      region: typeof flags.region === "string" ? flags.region.trim() : undefined,
      remote: parsedRemote.value,
      jobage: ints.jobage,
      page: ints.page ?? 1,
      limit: ints.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  // detail
  const input = (flags._ as string[])[1]
  if (!input) return fail("detail requires a job URL, or a posting id with --board", "NO_ID")
  const fmt = flags.format !== undefined ? String(flags.format) : "json"
  if (!["json", "plain"].includes(fmt)) return fail(`--format must be one of json|plain, got "${fmt}"`)
  const opts: DetailOpts = { input, board, format: fmt as DetailOpts["format"] }
  return runDetail(opts)
}

// Set the exit code and let the process end on its own, so piped stdout is fully
// drained first (process.exit can cut off a large detail write).
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
