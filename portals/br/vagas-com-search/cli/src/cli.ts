#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Vagas.com's public server-rendered
// search pages (Brazil). No external CLI framework, so it runs anywhere `bun`
// is available with zero install beyond the repo clone.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { slugify } from "./helpers.js"

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

const HELP = `vagas-com-cli — search jobs on Vagas.com (Brazil)

USAGE
  bun run src/cli.ts search --query "<text>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Job title or keyword. REQUIRED — Vagas.com's search URLs
                         are keyword-slug based (e.g. /vagas-de-desenvolvedor).
  --location, -l <text>  City name filter, e.g. "Goiânia". Appended to the URL as
                         "-em-<city>". Omit for nationwide/remote results.
  --jobage <days>        Posted within N days. Applied client-side (Vagas.com's
                         search pages have no posting-age parameter).
  --page <n>             1-indexed page. Default 1.
  --limit, -n <n>        Cap results emitted (client-side).
  --format <fmt>         json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "desenvolvedor" -l "Goiânia" --format table
  bun run src/cli.ts search -q "programador trainee" -l "Goiânia" --format table
  bun run src/cli.ts search -q "estágio TI" --jobage 14 --format table
  bun run src/cli.ts detail 2814044 --format plain
`

function writeArgError(error: string, code = "BAD_ARG"): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

// Number(), not parseInt(): parseInt truncates, so "--jobage 0.5" became 0 and
// silently turned the date filter off, and "--limit 10days" read as 10.
// Whole numbers >= 1 only, as in the other portals.
function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    writeArgError(`--${name} must be a whole number of at least 1, got "${raw}"`)
    return null
  }
  return val
}

// Long-form names each command accepts (parseFlags resolves q/l/n first).
// Anything else exits 1: a discarded filter would change what the search
// returns with no error.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "page", "limit", "format", "help", "h"]),
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

  // Own keys only: a command named "constructor" or "__proto__" must not resolve to Object.prototype.
  const knownFlags = Object.hasOwn(KNOWN_FLAGS, cmd) ? KNOWN_FLAGS[cmd] : undefined
  if (!knownFlags) return writeArgError(`Unknown command "${cmd}"`, "BAD_CMD")
  for (const key of Object.keys(flags)) {
    if (key === "_" || knownFlags.has(key)) continue
    return writeArgError(
      `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help`,
      "UNKNOWN_FLAG",
    )
  }

  // An unquoted multi-word value ("-q programador trainee") would otherwise
  // search only its first word.
  const extra = (flags._ as string[]).slice(cmd === "detail" ? 2 : 1)
  if (extra.length > 0) {
    return writeArgError(`unexpected argument "${extra[0]}" for '${cmd}'; quote multi-word values, see --help`)
  }

  if (cmd === "search") {
    if (flags.query === undefined) return writeArgError("the --query/-q flag is required", "NO_QUERY")
    // A present-but-empty value would silently broaden the search.
    for (const name of ["query", "location", "format"]) {
      const value = flags[name]
      if (value !== undefined && (typeof value !== "string" || !value.trim())) {
        return writeArgError(`--${name} requires a non-empty value`)
      }
    }
    const query = flags.query as string
    const location = flags.location as string | undefined
    // The search URL is a slug, so a value with no letters or digits has nothing to search for.
    if (!slugify(query)) return writeArgError(`--query "${query}" has no letters or digits to search for`, "NO_QUERY")
    if (location !== undefined && !slugify(location)) {
      return writeArgError(`--location "${location}" has no letters or digits to filter on`)
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
      query,
      location,
      jobage: ints.jobage,
      page: ints.page ?? 1,
      limit: ints.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  // detail
  const id = (flags._ as string[])[1]
  if (!id) return writeArgError("detail requires an <id|url>", "NO_ID")
  const fmt = flags.format !== undefined ? String(flags.format) : "json"
  if (!["json", "plain"].includes(fmt)) {
    return writeArgError(`--format must be one of json|plain, got "${fmt}"`)
  }
  return runDetail({ id, format: fmt as DetailOpts["format"] })
}

main().then((code) => process.exit(code))
