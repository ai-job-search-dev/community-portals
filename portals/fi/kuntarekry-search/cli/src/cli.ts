#!/usr/bin/env bun
import { runSearch } from "./commands/search.js"
import { runDetail } from "./commands/detail.js"
import { CLIError, PAGE_MAX, writeError, type Format } from "./helpers.js"

const HELP = `kuntarekry-cli: search Finnish public-sector jobs on Kuntarekry.fi

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain|table]

SEARCH FLAGS
  --query, -q <text>     Keywords (title and posting text). One word per call works best.
  --location, -l <name>  Municipality or region, comma-separated: Helsinki,Espoo or Uusimaa.
  --type <name>          internship | summer job | job | gig | apprenticeship, or the
                         board's own name (Harjoittelu, Kesätyö, Työpaikka, ...).
  --employment <name>    permanent | fixed term (Vakinainen | Määräaikainen).
  --hours <name>         full time | part time | hourly (Kokoaikatyö | Osa-aikatyö | Tuntityö).
  --remote <name>        full | partial | none.
  --org-type <name>      wellbeing | municipality | company | school.
  --jobage <days>        Only jobs posted in the last N days (Finnish calendar days).
  --sort <order>         newest (default) | deadline (closest deadline first).
  --page <n>             Page of results, 1-999 (the board serves no page past 999).
  --limit, -n <n>        Results per page, 1-48 (default 20; the board's cap is 48).
  --format <format>      json (default) | table | plain.
  --help, -h             Show help.

Names are matched without case or accents (Hameenlinna = Hämeenlinna); an unknown
name is an error that lists close matches. Without --sort, results are newest first.
`

const VALUE_FLAGS = new Set(["query", "location", "type", "employment", "hours", "remote", "org-type", "jobage", "sort", "page", "limit", "format"])
const BOOL_FLAGS = new Set(["help"])
const ALIASES: Record<string, string> = { q: "query", l: "location", n: "limit", h: "help" }

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP)
    return
  }
  const [command, ...args] = argv
  if (command !== "search" && command !== "detail") throw new CLIError(`Unknown command: ${command}`, "UNKNOWN_COMMAND")

  const flags: Record<string, string | true> = {}
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg)
      continue
    }
    const m = arg.match(/^--?([a-z][a-z-]*)(?:=([\s\S]*))?$/i)
    if (!m) throw new CLIError(`Invalid flag: ${arg}`, "UNKNOWN_FLAG")
    // A single dash takes only a one-letter alias; "-query" is a typo, not --query.
    if (!arg.startsWith("--") && m[1].length !== 1) throw new CLIError(`Unknown flag: ${arg}`, "UNKNOWN_FLAG")
    const key = ALIASES[m[1]] ?? m[1]
    const known = VALUE_FLAGS.has(key) || BOOL_FLAGS.has(key)
    if (!known || (command === "detail" && !["format", "help"].includes(key))) throw new CLIError(`Unknown flag: --${key}`, "UNKNOWN_FLAG")
    if (key in flags) throw new CLIError(`Duplicate flag: --${key}`, "BAD_ARG")
    if (BOOL_FLAGS.has(key)) {
      if (m[2] !== undefined) throw new CLIError(`--${key} does not take a value`, "BAD_ARG")
      flags[key] = true
      continue
    }
    const value = m[2] ?? args[++i]
    if (value === undefined || !value.trim() || (m[2] === undefined && value.startsWith("-"))) {
      throw new CLIError(`--${key} requires a value`, "MISSING_REQUIRED")
    }
    flags[key] = value.trim()
  }
  if (flags.help) {
    process.stdout.write(HELP)
    return
  }

  const format = (flags.format ?? "json") as string
  if (!["json", "table", "plain"].includes(format)) throw new CLIError("Invalid --format; use json, table or plain", "BAD_ARG")

  if (command === "detail") {
    if (positional.length !== 1) throw new CLIError("detail requires exactly one job id or URL", "MISSING_REQUIRED")
    await runDetail(positional[0], format as Format)
    return
  }
  if (positional.length) throw new CLIError(`Unexpected argument "${positional[0]}"; pass keywords with --query`, "BAD_ARG")

  const int = (key: string, fallback: number | undefined, max: number): number | undefined => {
    if (!(key in flags)) return fallback
    const raw = String(flags[key])
    const n = Number(raw)
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 1 || n > max) {
      throw new CLIError(`--${key} must be a whole number from 1 to ${max}`, "BAD_ARG")
    }
    return n
  }
  const str = (key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined)
  const sort = str("sort") ?? "newest"
  if (sort !== "newest" && sort !== "deadline") throw new CLIError("Invalid --sort; use newest or deadline", "BAD_ARG")

  await runSearch({
    query: str("query"),
    location: str("location"),
    type: str("type"),
    employment: str("employment"),
    hours: str("hours"),
    remote: str("remote"),
    orgType: str("org-type"),
    jobage: int("jobage", undefined, 3650),
    sort,
    // The board answers pages 1-999 and redirects /sivu1000/ and up to its HTML
    // site for every page size (checked 25.11.2026), so 999 is the real ceiling.
    page: int("page", 1, PAGE_MAX)!,
    limit: int("limit", 20, 48)!,
    format: format as Format,
  })
}

if (import.meta.main) {
  main().catch((error) => {
    writeError(error)
    process.exitCode = 1
  })
}
