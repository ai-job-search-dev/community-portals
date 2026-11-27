# gracklehq-cli

CLI for searching games-industry jobs aggregated by [Grackle HQ](https://gracklehq.com)
from studios' careers pages.

**Data source**: the public, server-rendered `/jobs` list and the `/rd/<id>` redirect to
each posting. See `../url-reference.md`.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is needed only
for development: it installs the TypeScript compiler and `@types/bun` that `bun run typecheck`
uses. Running the CLI needs nothing but `bun`.

Grackle is a free, donation-funded public service. Keep volume low: one search per term,
details only for promising hits. The CLI caps `--jobage` paging at 5 pages with a pause.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Title search (the board matches a substring; the CLI keeps only hits that start at a word, so "unity" skips "Community"), filtered by department, Remote/country and age |
| `detail` | Resolve a job id to the studio's posting URL (Grackle hosts no description) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. Errors go to **stderr** as `{ "error": "...", "code": "..." }` with
exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q unity -l Remote --format table
bun run src/cli.ts search -d Engineering -l Remote --jobage 14 --format table
bun run src/cli.ts detail 384925 --format plain
```

## Development

```bash
bun run typecheck
bun run test      # network-free: saved pages served from a local server
```

The HTML hygiene helpers at the top of `src/helpers.ts` (`visibleHtml`, `stripInvisible`,
entity decoding) are copied verbatim from community-portals' `linkedin-search` (MIT).
