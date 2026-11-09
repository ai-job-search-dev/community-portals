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

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit" }
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

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = parseInt(raw as string, 10)
      if (isNaN(val)) {
        process.stderr.write(JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n")
        return null
      }
      return val
    }

    let page = 1
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      page = Math.max(1, v)
    }

    let size = 20
    const sizeRaw = flags.size ?? flags.limit
    if (sizeRaw !== undefined) {
      const v = parseIntFlag("size", sizeRaw)
      if (v === null) return 1
      size = Math.max(1, v)
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

    const sort = typeof flags.sort === "string" ? flags.sort : "date_desc"
    if (sort !== "date_desc" && sort !== "date_asc") {
      process.stderr.write(
        JSON.stringify({ error: `--sort must be "date_desc" or "date_asc", got "${sort}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }

    const cantons =
      typeof flags.canton === "string"
        ? flags.canton
            .split(",")
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean)
        : undefined

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
    const opts: DetailOpts = {
      id,
      format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"],
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
