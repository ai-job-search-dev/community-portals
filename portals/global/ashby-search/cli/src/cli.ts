#!/usr/bin/env bun
// Self-contained CLI for reading company job boards hosted on Ashby, via
// Ashby's public Job Postings API. No authentication, zero runtime
// dependencies: it runs anywhere `bun` is available.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { isValidBoard, REMOTE_MODES } from "./helpers.js"

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

const MAX_BOARDS = 25

const HELP = `ashby-cli — read company job boards hosted on Ashby (public Job Postings API)

USAGE
  bun run src/cli.ts search --board <slug[,slug...]> [flags]
  bun run src/cli.ts detail <url | id --board <slug>> [--format json|plain]

SEARCH FLAGS
  --board, -b <slugs>     Company board slug(s). REQUIRED. The path segment in
                          jobs.ashbyhq.com/<slug>, e.g. "linear". Comma-separate up to ${MAX_BOARDS}.
  --query, -q <text>      Title keywords; every word must appear in the title.
  --location, -l <text>   Substring match on primary or secondary locations, e.g. "New York", "Remote".
  --remote <mode>         remote | hybrid | onsite (Ashby workplaceType; "remote" also
                          matches boards that only say Remote in the location).
  --jobage <days>         Published within N days.
  --page <n>              1-indexed page (20 results/page, newest first). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

DETAIL
  Accepts a jobs.ashbyhq.com/<slug>/<id> URL (board read from the URL), a company
  careers URL carrying ?ashby_jid=<id> together with --board, or an ID with --board.

EXAMPLES
  bun run src/cli.ts search -b linear,ramp,notion -q "engineer" --format table
  bun run src/cli.ts search -b ramp -q "product manager" --remote remote --jobage 14
  bun run src/cli.ts detail https://jobs.ashbyhq.com/ramp/<id> --format plain
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["board", "query", "location", "remote", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["board", "format", "help", "h"]),
}

function fail(error: string, code = "BAD_ARG"): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
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

  let boards: string[] = []
  if (flags.board !== undefined) {
    if (typeof flags.board !== "string") return fail("--board requires a value, e.g. -b linear")
    boards = [...new Set(flags.board.split(",").map((b) => b.trim()).filter(Boolean))]
    const bad = boards.find((b) => !isValidBoard(b))
    if (bad !== undefined || boards.length === 0) {
      return fail(`--board must be Ashby board slugs such as "linear" (letters, digits, ., - and _), got "${bad ?? flags.board}"`)
    }
  }

  if (cmd === "search") {
    if (boards.length === 0) return fail("the --board/-b flag is required (e.g. -b linear or -b linear,ramp)", "NO_BOARD")
    if (boards.length > MAX_BOARDS) return fail(`--board accepts at most ${MAX_BOARDS} boards per call, got ${boards.length}`)
    for (const name of ["query", "location"] as const) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !(flags[name] as string).trim())) {
        return fail(`--${name} requires a non-empty value`)
      }
    }
    let remote: string | undefined
    if (flags.remote !== undefined) {
      remote = typeof flags.remote === "string" ? flags.remote.toLowerCase().replace("on-site", "onsite") : undefined
      if (!remote || !(REMOTE_MODES as readonly string[]).includes(remote)) {
        return fail(`--remote must be one of ${REMOTE_MODES.join("|")}, got ${remote ? `"${remote}"` : "no value"}`)
      }
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return fail(`--format must be one of json|table|plain, got "${fmt}"`)

    const ints: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] === undefined) continue
      const raw = flags[name]
      const v = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(v) || v < 1) return fail(`--${name} must be a whole number of at least 1, got "${raw}"`)
      ints[name] = v
    }

    const opts: SearchOpts = {
      boards,
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      remote,
      jobage: ints.jobage,
      page: ints.page ?? 1,
      limit: ints.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  // detail
  if (boards.length > 1) return fail("detail takes a single --board")
  const input = (flags._ as string[])[1]
  if (!input) return fail("detail requires a job URL, or a job ID with --board", "NO_ID")
  const fmt = flags.format !== undefined ? String(flags.format) : "json"
  if (!["json", "plain"].includes(fmt)) return fail(`--format must be one of json|plain, got "${fmt}"`)
  const opts: DetailOpts = { input, board: boards[0], format: fmt as DetailOpts["format"] }
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
