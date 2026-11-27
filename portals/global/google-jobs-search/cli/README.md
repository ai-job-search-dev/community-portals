# google-jobs-search-cli

CLI for searching **Google Jobs** (Google's jobs panel) through the Apify Actor
[`krammer/google-jobs-scraper`](https://apify.com/krammer/google-jobs-scraper),
across the US, UK, India and Germany.

**Data source**: `api.apify.com`. This CLI never requests google.com.
**Authentication**: an Apify API token in `APIFY_API_TOKEN`.
**Dependencies**: none at runtime (plain `bun` + `fetch`). `bun install` is optional; it pulls the optional development tooling only: the TypeScript compiler (`tsc`, for `bun run typecheck`) and Bun's type definitions.

> **Metered and personal use only.** Every `search` starts a paid Actor run on
> your Apify account. Google's terms restrict automated access to its services;
> keep volume low and use it for personal use. Run it on your own responsibility.

## Installation

```bash
cd .agents/skills/google-jobs-search/cli
bun install   # optional — installs the optional dev tooling (tsc + Bun types)
export APIFY_API_TOKEN=...   # from Apify Console -> Settings -> API & Integrations
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search Google Jobs (`--query` required) |
| `detail` | Read one record from an already-finished run's dataset |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Software roles in San Francisco, last 7 days
bun run src/cli.ts search -q "software engineer" -l "San Francisco, CA" --jobage 7 --format table

# Remote data analyst roles
bun run src/cli.ts search -q "data analyst" --remote --format table

# Full detail for one posting (id from a search result)
bun run src/cli.ts detail jPV8SE3dHqcuO2M3C:0 --format plain
```

See `../SKILL.md` for the full flag reference, the Terms note and the page-cost note.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | **Required.** Keywords (title / skill / role). |
| `--location` | `-l` | Free-text location, e.g. `"Chicago, IL"`. |
| `--country` | | `us` (default) \| `gb` \| `in` \| `de`. |
| `--jobage` | | Posted within N days: `1`, `2`–`3`, `4`–`7`, `8`–`30`; more than `30` means any time. |
| `--remote` | | Boolean; only remote postings. |
| `--page` | | 1-indexed page. |
| `--limit` | `-n` | Results per page. Default `10`, maximum `200`. |
| `--format` | | `json` \| `table` \| `plain`. |

`page × limit` above `200` exits `1` with `PAGE_TOO_DEEP`, because one Actor run
returns at most 200 results.

## Tests

```bash
bun test
```

The tests are network-free. They serve two captured Apify responses
(`tests/fixtures/`) over loopback, and `tests/no-network.ts` blocks every host
but loopback, so a test can never spend Apify quota.
