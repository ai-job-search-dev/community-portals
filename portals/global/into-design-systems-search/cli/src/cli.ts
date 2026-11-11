#!/usr/bin/env bun
import { normalizeSlug, runDetail, type DetailOpts } from "./commands/detail.js"
import { runSearch, type SearchOpts } from "./commands/search.js"
import { AdapterError, daysAgoIso, isCalendarDate, writeError } from "./helpers.js"

type FlagValue = string | boolean
interface Flags {
  _: string[]
  [key: string]: FlagValue | string[]
}

const HELP = `into-design-systems-cli — search public Design System and AI design roles through MCP

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <slug|detail-url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>       Free-text title, company, or summary query.
  --country, -l <text>     Country or region from the posting, e.g. Germany, EMEA, USA.
  --remote <mode>          remote | hybrid | onsite; only explicitly stated work types.
  --jobage <days>          Posted within N whole days.
  --before <YYYY-MM-DD>    Posted before this day, exclusive. Pair with --jobage to
                           walk the board in windows when a search comes back truncated.
  --limit, -n <n>          1–100; default 20.
  --format <fmt>           json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "design tokens" --jobage 14 --format table
  bun run src/cli.ts search -l Germany --remote hybrid --limit 50
  bun run src/cli.ts search --jobage 60 --before 2026-08-01 --format table
  bun run src/cli.ts detail gitlab-senior-product-designer-ai-dtkb4g --format plain

The board has no offset paging: narrow a truncated search with --jobage and --before.
This is a read-only client for https://jobs.intodesignsystems.com/mcp. It never applies for a role.
`

const COMMAND_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "country", "remote", "jobage", "before", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

const WORK_TYPES = ["remote", "hybrid", "onsite"] as const

function fail(message: string): never {
  throw new AdapterError(message, "BAD_ARGUMENT")
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const aliases: Record<string, string> = { q: "query", l: "country", n: "limit" }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("-")) {
      flags._.push(arg)
      continue
    }
    const name = arg.replace(/^-+/, "")
    const key = aliases[name] ?? name
    const value = argv[index + 1]
    if (!value || value.startsWith("-")) {
      flags[key] = true
    } else {
      flags[key] = value
      index += 1
    }
  }
  return flags
}

function stringFlag(flags: Flags, key: string): string | undefined {
  return typeof flags[key] === "string" ? (flags[key] as string) : undefined
}

function numberFlag(flags: Flags, key: string, fallback?: number): number | undefined {
  const value = stringFlag(flags, key)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) fail(`--${key} must be a positive whole number`)
  return parsed
}

function formatFlag(flags: Flags, tableAllowed: boolean): "json" | "table" | "plain" {
  const value = stringFlag(flags, "format") ?? "json"
  const allowed = tableAllowed ? ["json", "table", "plain"] : ["json", "plain"]
  if (!allowed.includes(value)) fail(`--format must be one of ${allowed.join(", ")}`)
  return value as "json" | "table" | "plain"
}

function validateFlags(command: string, flags: Flags): void {
  const allowed = COMMAND_FLAGS[command]
  if (!allowed) return
  for (const key of Object.keys(flags)) {
    if (key !== "_" && !allowed.has(key)) fail(`unknown flag --${key} for '${command}'`)
  }
}

function searchOpts(flags: Flags): SearchOpts {
  const remote = stringFlag(flags, "remote")
  if (remote && !WORK_TYPES.includes(remote as (typeof WORK_TYPES)[number])) {
    fail(`--remote must be one of ${WORK_TYPES.join(", ")}`)
  }

  const before = stringFlag(flags, "before")
  // Checked locally so a typo costs no round trip and reads as a bad argument
  // rather than as a server error. The board rejects bad dates too.
  if (before !== undefined && !isCalendarDate(before)) {
    fail("--before must be a real ISO date, e.g. 2026-08-01")
  }

  // An inverted window is the one date mistake the board does not report: it
  // simply returns zero roles, which is indistinguishable from an empty board.
  const jobage = numberFlag(flags, "jobage")
  if (jobage !== undefined && before) {
    const from = daysAgoIso(jobage)
    if (from >= before) {
      fail(`--jobage ${jobage} starts at ${from}, on or after --before ${before}: that window is empty`)
    }
  }

  const limit = numberFlag(flags, "limit", 20)!
  if (limit > 100) fail("--limit cannot exceed 100")

  return {
    query: stringFlag(flags, "query"),
    country: stringFlag(flags, "country"),
    workType: remote as (typeof WORK_TYPES)[number] | undefined,
    jobage,
    before,
    limit,
    format: formatFlag(flags, true),
  }
}

function detailOpts(flags: Flags): DetailOpts {
  const slug = normalizeSlug(flags._[1] ?? "")
  if (!slug) fail("detail requires an Into Design Systems job slug or detail URL")
  return { slug, format: formatFlag(flags, false) as "json" | "plain" }
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const command = flags._[0]
  if (!command || flags.help || flags.h) {
    process.stdout.write(HELP)
    return command ? 0 : 1
  }
  try {
    validateFlags(command, flags)
    if (command === "search") await runSearch(searchOpts(flags))
    else if (command === "detail") await runDetail(detailOpts(flags))
    else fail(`unknown command '${command}'`)
    return 0
  } catch (error) {
    writeError(error)
    return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    writeError(error)
    process.exit(1)
  })
