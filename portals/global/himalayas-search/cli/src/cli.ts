#!/usr/bin/env bun
// Himalayas CLI — search remote tech jobs on Himalayas public API (https://himalayas.app/jobs/api).
// Keyless, public JSON, zero external runtime dependencies.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = {
  q: "query",
  n: "limit",
  l: "location",
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const name = a.replace(/^-+/, "")
      const key = ALIAS[name] ?? name
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

const HELP = `himalayas-cli — search remote tech jobs on Himalayas

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keyword search (title, excerpt, company, categories).
  --jobage <days>         Posted within the last N days.
  --page <n>              1-indexed page of the filtered results, scanning from the top and capped at 15 feed pages / 300 jobs; a page deeper than the scan returns fewer results, and meta.scanned_matches reports how many matches the scan collected (bounded by page × limit and the 300-job cap, not a total). Default: 1.
  --limit, -n <n>         Results limit (client-side cap). Default: 20.
  --category <cat>        Category filter (e.g. Developer, Fullstack-Development).
  --location, -l <text>   Location restriction filter (e.g. US, UK, Worldwide).
  --format <fmt>          json (default) | table | plain.

DETAIL
  <id|slug|url>           Job slug, guid, numeric ID, or full Himalayas URL.

EXAMPLES
  bun run src/cli.ts search -q "frontend" --format table
  bun run src/cli.ts search -q "React" --jobage 14 --limit 10 --format table
  bun run src/cli.ts detail law-assessment-expert-fully-remote-upto-105-hr-7927796087 --format plain
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query",
    "jobage",
    "page",
    "limit",
    "category",
    "location",
    "format",
    "help",
    "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    process.stderr.write(
      JSON.stringify({
        error: `--${name} must be a whole number of at least 1, got "${raw}"`,
        code: "BAD_ARG",
      }) + "\n",
    )
    return null
  }
  return val
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (flags.help || flags.h) {
    process.stdout.write(HELP)
    return 0
  }

  if (!cmd) {
    process.stdout.write(HELP)
    return 1
  }

  const known = KNOWN_FLAGS[cmd]
  if (known) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || known.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored; see --help for supported flags`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  const positionals = flags._ as string[]

  if (cmd === "search") {
    if (positionals.length > 1) {
      return fail(
        `'search' takes no positional arguments, got "${positionals.slice(1).join(" ")}" - use --query <text>`,
        "BAD_ARG",
      )
    }

    for (const name of ["query", "category", "location", "format"] as const) {
      if (flags[name] === true) {
        return fail(`--${name} requires a value`, "BAD_ARG")
      }
    }

    const fmt = (flags.format as string) || "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of: json, table, plain (got "${fmt}")`, "BAD_ARG")
    }

    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : undefined,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? Math.max(1, parseInt(flags.limit as string, 10)) : 20,
      category: typeof flags.category === "string" ? flags.category : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    if (positionals.length > 2) {
      return fail(
        `'detail' takes one identifier, got ${positionals.length - 1}: "${positionals.slice(1).join(" ")}"`,
        "BAD_ARG",
      )
    }
    const id = positionals[1]
    if (!id) {
      return fail("detail requires an <id|slug|url>", "NO_ID")
    }
    if (flags.format === true) {
      return fail("--format requires a value", "BAD_ARG")
    }
    const fmt = (flags.format as string) || "json"
    if (!["json", "plain"].includes(fmt)) {
      return fail(`--format must be json or plain for detail (got "${fmt}")`, "BAD_ARG")
    }
    const opts: DetailOpts = {
      id,
      format: fmt as DetailOpts["format"],
    }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
