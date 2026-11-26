#!/usr/bin/env bun
import { runSearch } from './commands/search.js'
import { runDetail } from './commands/detail.js'
import { CLIError, writeError, type Format } from './helpers.js'

const HELP = `thehub-cli — search public Nordic startup jobs on The Hub

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain|table]

SEARCH FLAGS
  --query, -q <text>      Keywords (matches posting content, not just title).
  --location, -l <text>   City or area, e.g. Copenhagen.
  --country <code>       DK (default), SE, NO, FI, IS, EU, NI.
  --remote               Remote jobs; all countries unless --country supplied.
  --jobage <days>        Client-side age filter; fetches dates from job details.
  --page <n>             Source page, starting at 1 (currently 15 jobs/page).
  --limit, -n <n>        Maximum results from this page (default 15).
  --sort <order>         newest (default) | popular.
  --format <format>      json (default) | table | plain.
  --help, -h             Show help.

Search dates are null without --jobage. With it, up to one detail read per
candidate on the selected page is needed. No automatic pagination.
detail returns full text, posting date, status, portal expiry and apply URL.
`
const VALUES = new Set(['query', 'location', 'country', 'jobage', 'page', 'limit', 'sort', 'format'])
const ALIASES: Record<string, string> = { q: 'query', l: 'location', n: 'limit', h: 'help' }

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') { process.stdout.write(HELP); return }
  const [command, ...args] = argv
  if (command !== 'search' && command !== 'detail') throw new CLIError(`Unknown command: ${command}`, 'UNKNOWN_COMMAND')
  const flags: Record<string, string | boolean> = {}, positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('-')) { positional.push(arg); continue }
    const match = arg.match(/^--?([\w-]+)(?:=(.*))?$/)
    if (!match) throw new CLIError(`Invalid flag: ${arg}`, 'UNKNOWN_FLAG')
    const key = ALIASES[match[1]] ?? match[1]
    if (!(VALUES.has(key) || key === 'remote' || key === 'help') || (command === 'detail' && !['format', 'help'].includes(key))) throw new CLIError(`Unknown flag: --${key}`, 'UNKNOWN_FLAG')
    if (key in flags) throw new CLIError(`Duplicate flag: --${key}`, 'BAD_ARG')
    if (!VALUES.has(key)) {
      if (match[2] !== undefined) throw new CLIError(`--${key} does not take a value`, 'BAD_ARG')
      flags[key] = true
    } else {
      const value = match[2] ?? args[++i]
      if (!value?.trim() || value.startsWith('-')) throw new CLIError(`--${key} requires a value`, 'MISSING_REQUIRED')
      flags[key] = value.trim()
    }
  }
  if (flags.help) { process.stdout.write(HELP); return }
  const format = flags.format ?? 'json'
  if (!['json', 'table', 'plain'].includes(String(format))) throw new CLIError('Invalid --format; use json, table or plain', 'BAD_ARG')
  if (command === 'detail') {
    if (positional.length !== 1) throw new CLIError('detail requires exactly one job ID or URL', 'MISSING_REQUIRED')
    await runDetail(positional[0], format as Format); return
  }
  if (positional.length) throw new CLIError('Unexpected search argument; pass keywords with --query', 'BAD_ARG')
  function number(key: string, fallback?: number): number | undefined {
    if (!(key in flags)) return fallback
    const value = Number(flags[key])
    if (!/^\d+$/.test(String(flags[key])) || !Number.isSafeInteger(value) || value < 1 || (key === 'jobage' && value > 36500)) throw new CLIError(`--${key} must be a positive integer${key === 'jobage' ? ' up to 36500' : ''}`, 'BAD_ARG')
    return value
  }
  const country = typeof flags.country === 'string' ? flags.country.toUpperCase() : undefined
  if (country && !['DK', 'SE', 'NO', 'FI', 'IS', 'EU', 'NI'].includes(country)) throw new CLIError('Unsupported --country; use DK, SE, NO, FI, IS, EU or NI', 'BAD_ARG')
  const sort = flags.sort ?? 'newest'
  if (sort !== 'newest' && sort !== 'popular') throw new CLIError('Invalid --sort; use newest or popular', 'BAD_ARG')
  await runSearch({ query: flags.query as string | undefined, location: flags.location as string | undefined,
    country, remote: flags.remote === true, jobage: number('jobage'), page: number('page', 1)!,
    limit: number('limit', 15)!, sort, format: format as Format })
}
if (import.meta.main) main().catch(error => { writeError(error); process.exitCode = 1 })
