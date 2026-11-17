# gamejobs-cli

CLI for searching games-industry jobs on [GameJobs.co](https://gamejobs.co), worldwide
and remote.

**Data source**: GameJobs.co public, server-rendered pages (`/search` and `/<slug>`).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is optional
and only pulls dev type definitions.

## Installation

```bash
cd .agents/skills/gamejobs-search/cli
bun install   # optional - only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings by keyword, place and posting age |
| `detail` | Fetch the full posting for one slug or gamejobs.co URL |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. All errors go to **stderr** as `{ "error": "...", "code": "..." }`
with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "unity developer" --jobage 14 --format table
bun run src/cli.ts search -q "gameplay programmer" -l "Remote" --format table
bun run src/cli.ts search -q '"tools programmer"' -l "Canada" --format table
bun run src/cli.ts detail Lead-Unity-Developer-at-Aristocrat-4757 --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords. `"..."` exact phrase, `OR` union, `-term` exclude. |
| `--location` | `-l` | City, state, country, or `Remote`. |
| `--jobage` | | Posted within N days (board filters at 1/7/31; narrowed client-side). |
| `--page` | | 1-indexed page (100 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` (default), `table`, `plain`. |

## Development

```bash
bun run typecheck
bun run test      # network-free: saved fixtures served from a local server
```

The output-hygiene helpers at the top of `src/helpers.ts` (`visibleHtml`, `stripInvisible`,
entity decoding) are copied verbatim from community-portals' `linkedin-search` (MIT). See `../url-reference.md` for the endpoints and the
parsing anchors to update if the board changes its markup.
