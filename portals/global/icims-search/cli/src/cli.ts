#!/usr/bin/env bun
// Self-contained CLI for reading employer job portals hosted on iCIMS, through
// the portals' public HTML. No authentication, zero runtime dependencies: it
// runs anywhere `bun` is available.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { parsePortal, type PortalRef, type Workplace } from "./helpers.js"

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
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", p: "portal" }
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

const HELP = `icims-cli — read employer job portals hosted on iCIMS (public HTML)

USAGE
  bun run src/cli.ts search --portal <subdomain|url> [flags]
  bun run src/cli.ts detail <url | id --portal <subdomain|url>> [--format json|plain]

SEARCH FLAGS
  --portal, -p <subdomain>  Employer's iCIMS portal. REQUIRED. Either the host label
                            (careers-usu) or a https://<portal>.icims.com/jobs URL.
  --query, -q <text>        Keywords, answered by iCIMS's own search (titles,
                            descriptions and locations). Double quotes make an exact
                            phrase; space-separated words are AND.
  --location, -l <text>     Substring match on the posting's location, e.g. "UT", "Remote".
  --remote <mode>           Client-side workplace filter: remote, hybrid or onsite. From the
                            portal's telework/remote field or a "Remote" location.
  --jobage <days>           Posted within N days (client-side; a card with no printed
                            date is kept, since there is nothing to compare it to).
  --page <n>                1-indexed results page (maps to the portal's own paging;
                            page size is set by the portal, 20 or 50 on sampled portals).
  --limit, -n <n>           Cap results emitted from this page (client-side).
  --format <fmt>            json (default) | table | plain.

DETAIL
  Accepts a https://<portal>.icims.com/jobs/<id>/<slug>/job URL (the portal is read
  from it), or a numeric job ID together with --portal - one or the other, never both.

EXAMPLES
  bun run src/cli.ts search -p careers-usu -q "engineer" --format table
  bun run src/cli.ts search -p careers-usu -q '"teaching assistant"' -l "Brigham" --format table
  bun run src/cli.ts detail https://careers-usu.icims.com/jobs/11021/biology-teaching-assistant/job --format plain
  bun run src/cli.ts detail 11021 -p careers-usu
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["portal", "query", "location", "remote", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["portal", "format", "help", "h"]),
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
  // `--_` would overwrite the positional array parseFlags builds, so `cmd`
  // would read the flag's value (or a boolean) and the reserved slot would be
  // corrupted. Report it as the unknown flag it is.
  if (!Array.isArray(flags._)) {
    return fail(
      "unknown flag --_ - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags",
      "UNKNOWN_FLAG",
    )
  }
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

  let portal: PortalRef | undefined
  if (flags.portal !== undefined) {
    if (typeof flags.portal !== "string") return fail("--portal requires a value")
    const parsed = parsePortal(flags.portal)
    if (!parsed) {
      return fail(
        `--portal must be an iCIMS portal subdomain such as "careers-usu", or a https://<portal>.icims.com/jobs URL, got "${flags.portal}"`,
      )
    }
    portal = parsed
  }

  if (cmd === "search") {
    if (!portal) return fail('the --portal/-p flag is required (e.g. -p careers-usu)', "NO_PORTAL")
    for (const name of ["query", "location"] as const) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !(flags[name] as string).trim())) {
        return fail(`--${name} requires a non-empty value`)
      }
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return fail(`--format must be one of json|table|plain, got "${fmt}"`)

    let remote: Workplace | undefined
    if (flags.remote !== undefined) {
      const value = typeof flags.remote === "string" ? flags.remote : ""
      if (value !== "remote" && value !== "hybrid" && value !== "onsite") {
        return fail(`--remote must be one of remote|hybrid|onsite, got "${flags.remote}"`)
      }
      remote = value
    }

    const ints: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] === undefined) continue
      const v = parsePositiveInt(name, flags[name])
      if (v === null) return 1
      ints[name] = v
    }

    const opts: SearchOpts = {
      portal,
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      remote,
      jobage: ints.jobage,
      page: ints.page ?? 1,
      limit: ints.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  // detail
  const input = (flags._ as string[])[1]
  if (!input) return fail("detail requires a job URL, or a job ID with --portal", "NO_ID")
  if (portal && !/^\d{1,12}$/.test(input.trim())) {
    return fail(
      "detail takes either a posting URL or a job ID with --portal, not both - a URL already names the portal",
    )
  }
  const fmt = flags.format !== undefined ? String(flags.format) : "json"
  if (!["json", "plain"].includes(fmt)) return fail(`--format must be one of json|plain, got "${fmt}"`)
  const opts: DetailOpts = { input, portal, format: fmt as DetailOpts["format"] }
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
