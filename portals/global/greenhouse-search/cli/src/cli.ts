#!/usr/bin/env bun
// Self-contained CLI for reading company job boards hosted on Greenhouse, via
// Greenhouse's public Job Board API. No authentication, zero runtime
// dependencies: it runs anywhere `bun` is available.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { isValidBoard, type Region } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

/** Parse argv; `repeated` names the first flag given more than once (aliases count as the same flag). */
function parseFlags(argv: string[]): { flags: Flags; repeated: string | null } {
  // Null prototype: a flag named like an Object.prototype member (e.g. --__proto__)
  // becomes an ordinary key that the unknown-flag check then rejects.
  const flags: Flags = Object.assign(Object.create(null) as Flags, { _: [] as string[] })
  let repeated: string | null = null
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", b: "board" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-")) {
      const name = a.replace(/^-+/, "")
      const key = Object.prototype.hasOwnProperty.call(alias, name) ? alias[name] : name
      if (repeated === null && Object.prototype.hasOwnProperty.call(flags, key)) repeated = key
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
  return { flags, repeated }
}

const HELP = `greenhouse-cli — read company job boards hosted on Greenhouse (public Job Board API)

USAGE
  bun run src/cli.ts search --board <token> [flags]
  bun run src/cli.ts detail <url | id --board <token>> [--format json|plain]

SEARCH FLAGS
  --board, -b <token>     Company board token. REQUIRED. The path segment after the host
                          in job-boards.greenhouse.io/<token>/jobs/..., e.g. "gitlab".
  --query, -q <text>      Title keywords; every word must appear in the title.
  --location, -l <text>   Substring match on the posting's location, e.g. "Remote", "Singapore".
  --jobage <days>         First published within N days.
  --page <n>              1-indexed page (20 results/page, newest first). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --region <us|eu>        Greenhouse data region. Default us.
  --format <fmt>          json (default) | table | plain.

DETAIL
  Accepts a job-boards.greenhouse.io / boards.greenhouse.io job URL (board read from the
  URL), or a numeric job ID together with --board.

EXAMPLES
  bun run src/cli.ts search -b gitlab -q "engineer" --format table
  bun run src/cli.ts search -b cloudflare -q "product manager" -l "Remote" --jobage 14
  bun run src/cli.ts detail https://job-boards.greenhouse.io/gitlab/jobs/8926445002 --format plain
  bun run src/cli.ts detail 8926445002 --board gitlab
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["board", "query", "location", "jobage", "page", "limit", "region", "format", "help", "h"]),
  detail: new Set(["board", "region", "format", "help", "h"]),
}

function fail(error: string, code = "BAD_ARG"): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

function parsePositiveInt(name: string, raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    fail(`--${name} must be a whole number of at least 1, got "${raw}"`)
    return null
  }
  return val
}

async function main(): Promise<number> {
  const { flags, repeated } = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
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

  const region = flags.region === undefined ? "us" : flags.region
  if (region !== "us" && region !== "eu") return fail(`--region must be us or eu, got "${region}"`)

  let board: string | undefined
  if (flags.board !== undefined) {
    if (typeof flags.board !== "string" || !isValidBoard(flags.board)) {
      return fail(`--board must be a board token such as "gitlab" (letters, digits, - and _), got "${flags.board}"`)
    }
    board = flags.board
  }

  if (cmd === "search") {
    if (!board) return fail('the --board/-b flag is required (e.g. -b gitlab)', "NO_BOARD")
    for (const name of ["query", "location"] as const) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !(flags[name] as string).trim())) {
        return fail(`--${name} requires a non-empty value`)
      }
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
      region: region as Region,
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage: ints.jobage,
      page: ints.page ?? 1,
      limit: ints.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  // detail
  const input = (flags._ as string[])[1]
  if (!input) return fail("detail requires a job URL, or a job ID with --board", "NO_ID")
  const fmt = flags.format !== undefined ? String(flags.format) : "json"
  if (!["json", "plain"].includes(fmt)) return fail(`--format must be one of json|plain, got "${fmt}"`)
  const opts: DetailOpts = { input, board, region: region as Region, format: fmt as DetailOpts["format"] }
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
