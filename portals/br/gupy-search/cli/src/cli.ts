#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Gupy's public "Portal de Vagas" (Brazil),
// via the JSON API the portal app itself calls (portal.gupy.io/api/job-search).
// No external CLI framework, so it runs anywhere `bun` is available with zero
// install beyond the repo clone.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
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

const HELP = `gupy-cli — search jobs on Gupy's public Portal de Vagas (Brazil)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <url> [--format json|plain]   (url = the search result's url field)

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, or role). Recommended.
  --location, -l <text>   City name filter, e.g. "Goiânia". Optional — combine with --remote
                          for remote-only results regardless of city.
  --remote <mode>         remote | hybrid | onsite. Filter by workplace type.
  --jobage <days>         Posted within N days. Applied client-side (Gupy's API has
                          no posting-age parameter) against each job's publishedDate.
  --page <n>              1-indexed page (10 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "desenvolvedor júnior" -l "Goiânia" --format table
  bun run src/cli.ts search -q "estágio TI" --remote remote --jobage 14 --format table
  bun run src/cli.ts search -q "automação n8n" --format table
  bun run src/cli.ts detail "https://<empresa>.gupy.io/job/<código>" --format plain
`

function writeArgError(error: string, code = "BAD_ARG"): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

// Number(), not parseInt(): parseInt truncates, so "--page 1.5" read as 1 and
// "--limit 10days" as 10. Whole numbers >= 1 only, as in the other portals.
function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    writeArgError(`--${name} must be a whole number of at least 1, got "${raw}"`)
    return null
  }
  return val
}

const REMOTE_MODES = ["remote", "hybrid", "onsite", "on-site"]

// Long-form names each command accepts (parseFlags resolves q/l/n first).
// Anything else exits 1: a discarded filter would change what the search
// returns with no error.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "remote", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (!knownFlags) return writeArgError(`Unknown command "${cmd}"`, "BAD_CMD")
  for (const key of Object.keys(flags)) {
    if (key === "_" || knownFlags.has(key)) continue
    return writeArgError(
      `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help`,
      "UNKNOWN_FLAG",
    )
  }

  // An unquoted multi-word value ("-q desenvolvedor júnior") would otherwise
  // search only its first word.
  const extra = (flags._ as string[]).slice(cmd === "detail" ? 2 : 1)
  if (extra.length > 0) {
    return writeArgError(`unexpected argument "${extra[0]}" for '${cmd}'; quote multi-word values, see --help`)
  }

  if (cmd === "search") {
    // These options take values; a present-but-empty one would silently broaden the search.
    for (const name of ["query", "location", "remote", "format"]) {
      const value = flags[name]
      if (value !== undefined && (typeof value !== "string" || !value.trim())) {
        return writeArgError(`--${name} requires a non-empty value`)
      }
    }
    const remote = flags.remote as string | undefined
    if (remote !== undefined && !REMOTE_MODES.includes(remote.toLowerCase())) {
      return writeArgError(`--remote must be one of remote|hybrid|onsite, got "${remote}"`)
    }

    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return writeArgError(`--format must be one of json|table|plain, got "${fmt}"`)
    }

    const ints: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] === undefined) continue
      const v = parseIntFlag(name, flags[name])
      if (v === null) return 1
      ints[name] = v
    }

    const opts: SearchOpts = {
      query: flags.query as string | undefined,
      location: flags.location as string | undefined,
      remote,
      jobage: ints.jobage,
      page: ints.page ?? 1,
      limit: ints.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  // detail
  const id = (flags._ as string[])[1]
  if (!id) return writeArgError("detail requires a job <url> from a search result", "NO_ID")
  const fmt = flags.format !== undefined ? String(flags.format) : "json"
  if (!["json", "plain"].includes(fmt)) {
    return writeArgError(`--format must be one of json|plain, got "${fmt}"`)
  }
  return runDetail({ id, format: fmt as DetailOpts["format"] })
}

main().then((code) => process.exit(code))
