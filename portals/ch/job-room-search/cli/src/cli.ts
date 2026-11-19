#!/usr/bin/env bun
// Self-contained CLI for searching jobs on job-room.ch — the official Swiss
// government (SECO / Public Employment Service) job platform. No external CLI
// framework, so it runs anywhere `bun` is available with zero install beyond
// the repo clone. Public, unauthenticated JSON API — no ToS-restricted scraping.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { ROMANDIE_CANTONS } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", n: "limit" }

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-")) {
      ;(flags._ as string[]).push(a)
      continue
    }
    // --canton=GE is the same as --canton GE. Without this the whole
    // "canton=GE" became the flag name and the filter was dropped silently.
    const eq = a.indexOf("=")
    if (eq > -1) {
      const name = a.slice(0, eq).replace(/^-+/, "")
      flags[ALIAS[name] ?? name] = a.slice(eq + 1)
      continue
    }
    const name = a.replace(/^-+/, "")
    const key = ALIAS[name] ?? name
    const next = argv[i + 1]
    // A flag with no following value (or another flag next) is a boolean.
    // Validation below rejects that for the flags that need a value.
    // A negative number is a value, not a flag: "--page -1" parsed as a bare
    // --page plus an unknown flag "--1", so the range check never saw it.
    const nextIsValue = next !== undefined && (!next.startsWith("-") || /^-\d/.test(next))
    if (!nextIsValue) {
      flags[key] = true
    } else {
      flags[key] = next
      i++
    }
  }
  return flags
}

// Long-form flag names each command accepts; parseFlags resolves the short
// aliases q/n to these first. "help"/"h" pass so `search --help` still works.
const KNOWN_FLAGS: Record<string, Set<string>> = Object.assign(Object.create(null), {
  search: new Set([
    "query", "canton", "workload-min", "workload-max", "page", "size", "limit", "sort", "format", "help", "h",
  ]),
  detail: new Set(["format", "help", "h"]),
})

// Flags that carry a value. A bare --canton or --sort parses as `true`, and
// treating that as unset silently drops a filter or a sort order while exiting 0.
const VALUE_FLAGS: Record<string, string[]> = Object.assign(Object.create(null), {
  search: ["query", "canton", "workload-min", "workload-max", "page", "size", "limit", "sort", "format"],
  detail: ["format"],
})

const CANTON_LIST = Object.entries(ROMANDIE_CANTONS)
  .map(([code, name]) => `${code}=${name}`)
  .join(", ")

const HELP = `job-room-cli — search jobs on job-room.ch (Swiss official job board / SECO)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keyword search (title, skill, role). Optional but recommended.
  --canton <codes>        Comma-separated canton codes, e.g. "GE,VD". Romandie: ${CANTON_LIST}.
  --workload-min <n>      Minimum workload percentage (0-100). Default: unset (API default 10).
  --workload-max <n>      Maximum workload percentage (0-100). Default: unset (API default 100).
  --page <n>              1-indexed page. Default 1.
  --size, --limit, -n <n> Results per page. Default 20.
  --sort <mode>           date_desc (default) | date_asc. ("relevance" is rejected by the API — 400.)
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "data engineer" --canton GE,VD --format table
  bun run src/cli.ts search -q "infirmier" --canton VD,VS,NE,FR,JU --workload-min 80 --format table
  bun run src/cli.ts detail e75c4b4a-ff96-477c-908b-91fd6416fdfc --format plain

NOTES
  - job-room.ch is the official Swiss government job platform (SECO / Public Employment
    Service, "service public de l'emploi" / ORP / RAV). Public JSON API, no auth required.
  - Many listings syndicate FROM external job boards (e.g. jobup.ch) via jobContent.externalUrl —
    the same role may also appear directly on that source; dedupe by title+company if aggregating.
  - IDs are UUIDs (e.g. e75c4b4a-ff96-477c-908b-91fd6416fdfc), not numeric like LinkedIn's.

Personal use only — public job-room.ch JSON API.
`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Validate the command before anything indexes the flag tables by it.
  // "toString" used to resolve to an inherited property and die as
  // INTERNAL_ERROR, and "apply extra" reported BAD_ARG instead of BAD_CMD.
  if (cmd !== "search" && cmd !== "detail") {
    process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
    return 1
  }

  // Reject unknown flags instead of discarding them: a dropped filter changes
  // what the search returns with no error at all.
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

  const extra = (flags._ as string[]).slice(cmd === "detail" ? 2 : 1)
  if (extra.length > 0) {
    process.stderr.write(
      JSON.stringify({ error: `unexpected argument "${extra[0]}" for '${cmd}'; see --help`, code: "BAD_ARG" }) + "\n",
    )
    return 1
  }

  for (const name of VALUE_FLAGS[cmd] ?? []) {
    const value = flags[name]
    if (value !== undefined && (typeof value !== "string" || !value.trim())) {
      process.stderr.write(
        JSON.stringify({ error: `--${name} requires a non-empty value`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    // Number(), not parseInt(): parseInt reads a numeric prefix, so
    // "--page 2oops" silently became 2 instead of failing validation.
    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val)) {
        process.stderr.write(
          JSON.stringify({ error: `--${name} must be a whole number, got "${raw}"`, code: "BAD_ARG" }) + "\n",
        )
        return null
      }
      return val
    }

    // Rejected, not clamped: Math.max(1, v) turned --page 0 into page 1 and
    // exited 0, so a caller paginating from zero silently re-read page one.
    let page = 1
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      if (v < 1) {
        process.stderr.write(
          JSON.stringify({ error: `--page must be at least 1, got ${v}`, code: "BAD_ARG" }) + "\n",
        )
        return 1
      }
      page = v
    }

    let size = 20
    const sizeRaw = flags.size ?? flags.limit
    if (sizeRaw !== undefined) {
      const v = parseIntFlag("size", sizeRaw)
      if (v === null) return 1
      if (v < 1) {
        process.stderr.write(
          JSON.stringify({ error: `--size must be at least 1, got ${v}`, code: "BAD_ARG" }) + "\n",
        )
        return 1
      }
      size = v
    }

    let workloadMin: number | undefined
    if (flags["workload-min"] !== undefined) {
      const v = parseIntFlag("workload-min", flags["workload-min"])
      if (v === null) return 1
      workloadMin = v
    }
    let workloadMax: number | undefined
    if (flags["workload-max"] !== undefined) {
      const v = parseIntFlag("workload-max", flags["workload-max"])
      if (v === null) return 1
      workloadMax = v
    }

    // Out-of-range or contradictory bounds return an empty result set that
    // looks like "no such jobs" rather than a bad request.
    for (const [name, value] of [
      ["workload-min", workloadMin],
      ["workload-max", workloadMax],
    ] as const) {
      if (value !== undefined && (value < 0 || value > 100)) {
        process.stderr.write(
          JSON.stringify({ error: `--${name} must be between 0 and 100, got ${value}`, code: "BAD_ARG" }) + "\n",
        )
        return 1
      }
    }
    if (workloadMin !== undefined && workloadMax !== undefined && workloadMin > workloadMax) {
      process.stderr.write(
        JSON.stringify({
          error: `--workload-min (${workloadMin}) must not exceed --workload-max (${workloadMax})`,
          code: "BAD_ARG",
        }) + "\n",
      )
      return 1
    }

    const sort = typeof flags.sort === "string" ? flags.sort : "date_desc"
    if (sort !== "date_desc" && sort !== "date_asc") {
      process.stderr.write(
        JSON.stringify({ error: `--sort must be "date_desc" or "date_asc", got "${sort}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }

    let cantons: string[] | undefined
    if (typeof flags.canton === "string") {
      cantons = flags.canton
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
      // "," and ", ," pass the non-empty check but leave nothing to filter on,
      // which ran a Switzerland-wide search and exited 0.
      if (cantons.length === 0) {
        process.stderr.write(
          JSON.stringify({
            error: `--canton "${flags.canton}" contains no canton code`,
            code: "BAD_ARG",
          }) + "\n",
        )
        return 1
      }
    }

    if (!["json", "table", "plain"].includes(fmt)) {
      process.stderr.write(JSON.stringify({ error: `--format must be json, table, or plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n")
      return 1
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      cantons,
      workloadMin,
      workloadMax,
      page,
      size,
      sort: sort as SearchOpts["sort"],
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    if (!["json", "plain"].includes(fmt)) {
      process.stderr.write(
        JSON.stringify({ error: `--format must be json or plain for detail, got "${fmt}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  // Unreachable: cmd is narrowed to "search" | "detail" above. Kept as a
  // belt-and-braces exit rather than a throw, so the error contract holds if
  // a command is ever added without a branch.
  process.stderr.write(JSON.stringify({ error: `Unhandled command "${cmd}"`, code: "BAD_CMD" }) + "\n")
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
