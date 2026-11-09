# djinni-cli

CLI for searching IT jobs on [Djinni](https://djinni.co/jobs/), the Ukrainian tech job
board, and reading full postings.

**Data source**: Djinni's public pages (`/jobs/?...` search results and `/jobs/<id>-<slug>/` postings), parsed from their HTML cards and schema.org JSON-LD.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> Djinni's `robots.txt` allows these pages. Keep volume low anyway: a few searches per
> session, never a crawl.

## Installation

```bash
cd .agents/skills/djinni-search/cli
bun install   # optional — dev dependencies only (TypeScript compiler and Bun types)
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings (all filters optional) |
| `detail` | Fetch full detail for a single posting by id or djinni.co URL |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# React roles, remote, open to candidates in Ukraine
bun run src/cli.ts search -q React --employment remote --region ukraine --format table

# Python roles, remote, $3000+/month
bun run src/cli.ts search -c Python --employment remote --salary 3000 --format table

# Full detail for one job
bun run src/cli.ts detail 855979 --format plain
```

See `../SKILL.md` for the full flag reference and `../url-reference.md` for the parsing anchors.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords. |
| `--search-type` | | `basic` (default) \| `full-text` \| `title`. Needs `--query`. |
| `--category` | `-c` | Djinni category, e.g. `"React.js"`, `JavaScript`, `Fullstack`. Unknown names are rejected. |
| `--employment` | | `remote` \| `parttime` \| `office`. |
| `--region` | | `ukraine` \| `eu` \| `worldwide` \| `other` (candidate countries). |
| `--location` | `-l` | City slug for office roles, e.g. `kyiv`, `lviv`. |
| `--salary` | | Monthly salary filter, USD. |
| `--public-salary` | | Only postings that show their salary. |
| `--jobage` | | Posted within N days (client-side). |
| `--page` | | 1-indexed page (15 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Tests

```bash
bun run test                  # offline: synthetic fixtures and mocked fetch
DJINNI_LIVE=1 bun run test    # also runs the live smoke test against djinni.co
```
