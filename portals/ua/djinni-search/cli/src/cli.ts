#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Djinni (djinni.co), the Ukrainian IT
// job board. No external CLI framework, so it runs anywhere `bun` is available
// with no install step.
//
// Djinni's robots.txt allows the /jobs/ pages this reads. Keep volume low anyway:
// a few requests per search session, never a crawl.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import {
  CITIES,
  EMPLOYMENT,
  SEARCH_TYPES,
  normalizeCategory,
  normalizeRegion,
  suggestCategories,
} from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  // No prototype, so a flag named `__proto__` or `constructor` is an ordinary
  // own key that the unknown-flag check sees, not an inherited one.
  const flags: Flags = Object.assign(Object.create(null), { _: [] })
  const alias: Record<string, string> = { q: "query", c: "category", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const name = a.replace(/^-+/, "")
      const key = Object.hasOwn(alias, name) ? alias[name] : name
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

const HELP = `djinni-cli — search IT jobs on Djinni (djinni.co), the Ukrainian tech job board

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords. Djinni's basic search matches titles and tags.
  --search-type <type>    basic (default) | full-text | title. Needs --query.
  --category, -c <name>   A Djinni category, e.g. "React.js", "JavaScript", "Fullstack",
                          "Node.js". Unknown names are rejected (Djinni would ignore them).
  --employment <mode>     remote | parttime | office.
  --region <region>       Countries the posting accepts candidates from:
                          ukraine | eu | worldwide | other.
  --location, -l <city>   City slug for office roles, e.g. kyiv, lviv, kharkiv, odesa.
  --salary <usd>          Djinni's monthly salary filter, in USD.
  --public-salary         Only postings that show their salary.
  --jobage <days>         Posted within N days (filtered client-side on this page).
  --page <n>              1-indexed page (15 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -c "React.js" --employment remote --region ukraine --format table
  bun run src/cli.ts search -c Python --employment remote --salary 3000 --format table
  bun run src/cli.ts search -q "LLM" --search-type full-text --jobage 7 --format table
  bun run src/cli.ts search -c JavaScript -l kyiv --format table
  bun run src/cli.ts detail 855979 --format plain

Djinni's robots.txt allows these pages; keep volume low all the same.
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/c/l/n to these before validation). "help"/"h" pass so `search --help`
// still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "search-type", "category", "employment", "region", "location", "salary",
    "public-salary", "jobage", "page", "limit", "format", "help", "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code = "BAD_ARG"): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
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
  // filter changes what the search returns with no error. A bogus flag
  // exits 1 with a JSON error on stderr.
  const knownFlags = Object.hasOwn(KNOWN_FLAGS, cmd) ? KNOWN_FLAGS[cmd] : undefined
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      return fail(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
    }
    // Same for stray words: `-q React Native` would otherwise search "React".
    const stray = (flags._ as string[])[cmd === "detail" ? 2 : 1]
    if (stray !== undefined) {
      const hint = cmd === "detail" ? "detail takes one <id|url>" : `quote multi-word values, e.g. -q "React Native"`
      return fail(`unexpected argument "${stray}" - ${hint}`)
    }
  }

  if (cmd === "search") {
    // A text flag that is present needs a value: parseFlags stores a bare
    // "--flag" as true and "--flag ''" as "", and treating either as unset
    // would run a wider search than the one asked for.
    const text = (name: string): string | undefined | null => {
      const v = flags[name]
      if (v === undefined) return undefined
      return typeof v === "string" && v.trim() ? v.trim() : null
    }

    const query = text("query")
    if (query === null) return fail("--query requires a non-empty value")

    let category: string | undefined
    const rawCategory = text("category")
    if (rawCategory === null) return fail("--category requires a value")
    if (rawCategory !== undefined) {
      const canonical = normalizeCategory(rawCategory)
      if (!canonical) {
        const close = suggestCategories(rawCategory)
        return fail(
          `unknown --category "${rawCategory}" - Djinni ignores category names it does not know and would return every posting on the board. ` +
            (close.length ? `Did you mean: ${close.join(", ")}?` : "See CATEGORIES in cli/src/helpers.ts for the list."),
        )
      }
      category = canonical
    }

    let searchType: string | undefined
    const rawType = text("search-type")
    if (rawType === null) return fail("--search-type requires a value")
    if (rawType !== undefined) {
      const typeKey = rawType.toLowerCase()
      searchType = Object.hasOwn(SEARCH_TYPES, typeKey) ? SEARCH_TYPES[typeKey] : undefined
      if (!searchType) return fail(`--search-type must be one of basic|full-text|title, got "${rawType}"`)
      if (!query) return fail("--search-type only applies together with --query")
    }

    const employment = text("employment")
    if (employment === null) return fail("--employment requires a value")
    if (employment !== undefined && !EMPLOYMENT.has(employment.toLowerCase())) {
      return fail(`--employment must be one of remote|parttime|office, got "${employment}"`)
    }

    let region: string | undefined
    const rawRegion = text("region")
    if (rawRegion === null) return fail("--region requires a value")
    if (rawRegion !== undefined) {
      const r = normalizeRegion(rawRegion)
      if (!r) return fail(`--region must be one of ukraine|eu|worldwide|other, got "${rawRegion}"`)
      region = r
    }

    const location = text("location")
    if (location === null) return fail("--location requires a city slug")
    if (location !== undefined && !CITIES.includes(location.toLowerCase())) {
      return fail(
        `--location must be a Djinni city slug (${CITIES.join(", ")}), got "${location}". For remote roles use --employment remote and --region instead.`,
      )
    }

    if (flags["public-salary"] !== undefined && flags["public-salary"] !== true) {
      return fail("--public-salary takes no value")
    }

    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`)
    }

    const parseIntFlag = (name: string): number | null | undefined => {
      const raw = flags[name]
      if (raw === undefined) return undefined
      // Number(), not parseInt(): parseInt truncates, so "--jobage 0.5" would
      // become 0 and silently drop the filter. Whole numbers >= 1 only.
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        fail(`--${name} must be a whole number of at least 1, got "${raw}"`)
        return null
      }
      return val
    }
    const salary = parseIntFlag("salary")
    const jobage = parseIntFlag("jobage")
    const page = parseIntFlag("page")
    const limit = parseIntFlag("limit")
    if (salary === null || jobage === null || page === null || limit === null) return 1

    const opts: SearchOpts = {
      query,
      category,
      searchType,
      employment: employment?.toLowerCase(),
      region,
      location: location?.toLowerCase(),
      salary,
      publicSalary: flags["public-salary"] === true,
      jobage,
      page: page ?? 1,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires an <id|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|plain, got "${fmt}"`)
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  return fail(`Unknown command "${cmd}"`, "BAD_CMD")
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
