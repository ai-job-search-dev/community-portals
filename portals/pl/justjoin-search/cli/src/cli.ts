#!/usr/bin/env bun
// Self-contained CLI for searching jobs on justjoin.it's public listing pages.
// No external CLI framework and no runtime dependencies, so it runs anywhere
// `bun` is available with nothing installed beyond the repo clone.
//
// Personal use only. This reads justjoin.it's public, robots-permitted
// /job-offers/ and /job-offer/ pages. Keep volume low, and do not use it
// commercially or for bulk data collection.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", c: "category" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
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

const HELP = `justjoin-cli — search jobs on justjoin.it (Polish IT job board)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>        Keywords (title, skill, technology). Recommended.
  --location, -l <city>     Polish city, e.g. "Warszawa", "Kraków", "Gdansk".
                            Default: all-locations (the whole country).
  --category, -c <slug>     Portal category path segment: php, python, javascript,
                            java, devops, testing, data, architecture, ...
  --workplace <mode>        remote | hybrid | office
  --experience <level>      junior | mid | senior | c-level
  --employment-type <type>  b2b | permanent | mandate | internship
  --with-salary             Only offers that disclose a salary band.
  --jobage <days>           Posted within N days. Applied client-side: justjoin
                            has no posting-age parameter (see SKILL.md Notes).
  --page <n>                Only 1 is supported — justjoin server-renders a single
                            batch and paginates over its private API.
  --limit, -n <n>           Cap results emitted (client-side).
  --format <fmt>            json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "PHP Symfony" --format table
  bun run src/cli.ts search -q "software architect" --workplace remote --experience senior --format table
  bun run src/cli.ts search -c php --employment-type b2b --with-salary --jobage 14 --format table
  bun run src/cli.ts search -q "payments" -l "Warszawa" --workplace remote --limit 10
  bun run src/cli.ts search -q "python" --workplace remote --jobage 7 --format json
  bun run src/cli.ts detail bitbag-mid-symfony-developer-opole-php-894bb716 --format plain

Personal use only — reads justjoin.it's public pages; keep volume low.
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/l/n/c to these before validation). "help"/"h" pass so `search --help`
// still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "location", "category", "workplace", "experience", "employment-type",
    "with-salary", "jobage", "page", "limit", "format", "help", "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

const WORKPLACES = ["remote", "hybrid", "office"]
const EXPERIENCE = ["junior", "mid", "senior", "c-level"]
const EMPLOYMENT = ["b2b", "permanent", "mandate", "internship"]

function badValue(flag: string, got: string, allowed: string[]): void {
  process.stderr.write(
    JSON.stringify({
      error: `--${flag} must be one of ${allowed.join(" | ")}, got "${got}"`,
      code: "BAD_ARG",
    }) + "\n",
  )
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = parseInt(raw as string, 10)
      if (isNaN(val)) {
        process.stderr.write(
          JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n",
        )
        return null
      }
      return val
    }

    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      if (v <= 0) {
        process.stderr.write(
          JSON.stringify({ error: `--jobage must be a positive number of days, got "${flags.jobage}"`, code: "BAD_ARG" }) + "\n",
        )
        return 1
      }
      flags.jobage = String(v)
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }
    // A silently-ignored --page would misreport coverage: the caller would
    // believe it had walked the result set when it had re-read page 1.
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      if (v !== 1) {
        process.stderr.write(
          JSON.stringify({
            error: `--page ${v} is not supported: justjoin.it server-renders a single batch of offers and paginates over its private API, which this CLI does not use. Narrow the search instead (--category, --experience, --workplace, -q).`,
            code: "PAGE_UNSUPPORTED",
          }) + "\n",
        )
        return 1
      }
    }

    const workplace = typeof flags.workplace === "string" ? flags.workplace.toLowerCase() : undefined
    if (workplace && !WORKPLACES.includes(workplace)) {
      badValue("workplace", workplace, WORKPLACES)
      return 1
    }
    const experience = typeof flags.experience === "string" ? flags.experience.toLowerCase() : undefined
    if (experience && !EXPERIENCE.includes(experience)) {
      badValue("experience", experience, EXPERIENCE)
      return 1
    }
    const employmentType =
      typeof flags["employment-type"] === "string" ? (flags["employment-type"] as string).toLowerCase() : undefined
    if (employmentType && !EMPLOYMENT.includes(employmentType)) {
      badValue("employment-type", employmentType, EMPLOYMENT)
      return 1
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      category: typeof flags.category === "string" ? flags.category : undefined,
      workplace,
      experience,
      employmentType,
      withSalary: flags["with-salary"] === true,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires a <slug|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = { id, format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"] }
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
