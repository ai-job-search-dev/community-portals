#!/usr/bin/env bun

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, normalizePositionId, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const BOOLEAN_FLAGS = new Set(["remote", "help", "h"])

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "keyword", l: "location", n: "per-page" }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || (a.startsWith("-") && a.length === 2)) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith("-")) {
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

const HELP = `usajobs-cli — search US federal government jobs via the USAJOBS API

SETUP
  Request a key at developer.usajobs.gov/apirequest/. USAJOBS emails it to you.
  export USAJOBS_API_KEY="the-key-from-the-usajobs-email"
  export USAJOBS_EMAIL="the-email-you-registered-with@example.com"

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --keyword, -q <text>  Keywords (title, skill, agency). Optional.
  --location, -l <text> City, state, or region. Omit for nationwide.
  --days <n>            Posted within N days (1, 7, 14, 30). Default: all.
  --remote              Filter to remote/telework-eligible positions only.
  --per-page, -n <n>    Results per page (1-500). Default 25.
  --page <n>            1-indexed page number. Default 1.
  --limit <n>           Cap total results (client-side).
  --format <fmt>        json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "software engineer" -l "California" --format table
  bun run src/cli.ts search -q "cybersecurity" --remote --days 7 --format table
  bun run src/cli.ts search -l "Texas" --per-page 50 --format table
  bun run src/cli.ts detail USGS-DEF-CA-26-00001 --format plain
  bun run src/cli.ts detail https://www.usajobs.gov/job/789456123/ --format plain

Requires USAJOBS_API_KEY and USAJOBS_EMAIL env vars. Register free at developer.usajobs.gov.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["keyword", "location", "days", "remote", "per-page", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    process.stderr.write(
      JSON.stringify({ error: `--${name} must be a whole number of at least 1, got "${raw}"`, code: "BAD_ARG" }) + "\n",
    )
    return null
  }
  return val
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return flags.help || flags.h ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}'; see --help for supported flags`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    if ((flags._ as string[]).length > 1) {
      process.stderr.write(
        JSON.stringify({ error: 'search takes flags only; quote multi-word keywords: -q "software engineer"', code: "BAD_ARG" }) + "\n",
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

    if (flags.keyword !== undefined && (typeof flags.keyword !== "string" || !flags.keyword.trim())) {
      process.stderr.write(JSON.stringify({ error: "--keyword requires a non-empty value", code: "BAD_ARG" }) + "\n")
      return 1
    }

    if (flags.location !== undefined && (typeof flags.location !== "string" || !flags.location.trim())) {
      process.stderr.write(JSON.stringify({ error: "--location requires a non-empty value", code: "BAD_ARG" }) + "\n")
      return 1
    }

    if (flags.days !== undefined) {
      const v = parseIntFlag("days", flags.days)
      if (v === null) return 1
      flags.days = String(v)
    }

    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      flags.page = String(v)
    }

    if (flags["per-page"] !== undefined) {
      const v = parseIntFlag("per-page", flags["per-page"])
      if (v === null) return 1
      if (v > 500) {
        process.stderr.write(
          JSON.stringify({ error: "--per-page maximum is 500", code: "BAD_ARG" }) + "\n",
        )
        return 1
      }
      flags["per-page"] = String(v)
    }

    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }

    const opts: SearchOpts = {
      keyword: typeof flags.keyword === "string" ? flags.keyword.trim() : undefined,
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      days: flags.days ? parseInt(flags.days as string, 10) : undefined,
      remote: flags.remote === true,
      page: flags.page ? parseInt(flags.page as string, 10) : 1,
      perPage: flags["per-page"] ? parseInt(flags["per-page"] as string, 10) : 25,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: fmt as SearchOpts["format"],
    }

    return runSearch(opts)
  }

  if (cmd === "detail") {
    const rawId = (flags._ as string[])[1]
    if (!rawId) {
      process.stderr.write(JSON.stringify({ error: "detail requires a <id|url> argument", code: "NO_ID" }) + "\n")
      return 1
    }

    if (normalizePositionId(rawId) === null) {
      process.stderr.write(
        JSON.stringify({ error: `Could not parse a USAJobs position ID or URL from "${rawId}"`, code: "BAD_ID" }) + "\n",
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

    const opts: DetailOpts = { id: rawId, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })
