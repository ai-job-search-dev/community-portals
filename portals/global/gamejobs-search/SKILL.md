---
name: gamejobs-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in the video game
  industry on GameJobs.co - game developer, gameplay programmer, Unity or Unreal
  developer, game designer, technical artist, live ops, QA and other studio roles -
  worldwide or remote, or look up a specific GameJobs.co posting. Invoke for
  games-industry openings, vacancies and hiring at game studios. Trigger phrases:
  game jobs, gamedev jobs, game developer jobs, video game jobs, game studio
  hiring, remote game jobs, "are there any Unity jobs", GameJobs.co, look up this
  GameJobs.co posting; Spanish: empleos de videojuegos, trabajo en videojuegos,
  ofertas de desarrollo de videojuegos.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/gamejobs-search/cli/src/cli.ts *)
---

# GameJobs.co Search Skill

Search live games-industry job listings on [GameJobs.co](https://gamejobs.co), a global
board for game studios (around 7,000 open postings, updated daily). No authentication, no
API key and **zero runtime dependencies**: it runs with just `bun`.

The board is sector-specific, not country-specific: postings come from studios worldwide,
and remote roles are listed with the location `Remote`.

## When to use this skill

- Search game-development openings by keyword, optionally by place (`--location`) or `Remote`
- Filter by recency (posted within N days)
- Get the full description, employment type and valid-through date of a specific posting

## Commands

### Search job listings

```bash
bun run .agents/skills/gamejobs-search/cli/src/cli.ts search -q "<keywords>" [flags]
```

Query syntax: double quotes inside the argument make an exact phrase, word order included; single quotes are ignored; `OR` between terms returns their union; a leading minus excludes a term (`unity -mobile`).

Key flags:
- `--query <text>` / `-q <text>` - keywords (title, skill, company). Recommended.
- `--location <text>` / `-l <text>` - the board's "Where?" box: a city, state, country, or `Remote`.
- `--jobage <days>` - posted within N days. The board only filters at 1, 7 or 31 days, so values up to 31 use the next window up and the CLI narrows the fetched page to the exact age from each card's "N days ago". Values above 31 send no age filter at all: only the fetched page is narrowed, so pass `--page` to read further. Cards whose age the CLI cannot parse are kept (an unknown age is not evidence that a posting is old). Months and years on the board are coarse ("1 month ago"), so dates older than ~4 weeks are approximate.
- `--page <n>` - page number (1-indexed, 100 results per page).
- `--limit <n>` / `-n <n>` - cap total results emitted (client-side).
- `--format json|table|plain` - default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/gamejobs-search/cli/src/cli.ts detail <slug|url> [--format json|plain]
```

`slug` is the `id` from `search` results (e.g. `Lead-Unity-Developer-at-Aristocrat-4757`).
A full `https://gamejobs.co/<slug>` URL also works; links to any other site are rejected.
Returns the full description, employment type, valid-through date (`deadline`) and the
external apply link.

## Usage examples

```bash
# Unity roles posted in the last 14 days
bun run .agents/skills/gamejobs-search/cli/src/cli.ts search -q "unity developer" --jobage 14 --format table

# Remote gameplay programming roles
bun run .agents/skills/gamejobs-search/cli/src/cli.ts search -q "gameplay programmer" -l "Remote" --format table

# Exact-phrase backend roles in Canada, last week
bun run .agents/skills/gamejobs-search/cli/src/cli.ts search -q '"backend engineer"' -l "Canada" --jobage 7 --format table

# Unity jobs that are not mobile
bun run .agents/skills/gamejobs-search/cli/src/cli.ts search -q "unity -mobile" -l "Remote" --format table

# Full detail for one posting
bun run .agents/skills/gamejobs-search/cli/src/cli.ts detail Lead-Unity-Developer-at-Aristocrat-4757 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, passing `id` to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single posting (`detail`) or a short list |

Search JSON is `{ "meta": { "count", "page", "total", "hasNext" }, "results": [...] }`. `total` and
`hasNext` are the board's own figures for the query; `count` is what this call emitted after
`--jobage` narrowing and `--limit`, so `count: 0` with a large `total` means the page had no
posting inside the window, not that nothing matches. Each
result has `id`, `jobId`, `title`, `company`, `location`, `date`, `dateText` and `url`
(missing values are `null`). All errors go to **stderr** as `{ "error": "...", "code": "..." }`
with exit code `1`.

## Notes

- Data comes from the board's public, server-rendered pages: `/search` and `/<slug>`. `robots.txt` allows both for general user agents (it blocks only a list of AI-training and SEO crawlers, and `/jobs/*/save`). The board's own FAQ documents its search-result feeds. Keep volume low: one search per term, details only for promising hits.
- `date` is derived from the card's relative age ("7 days ago"); `dateText` keeps the original. `detail` returns the exact `datePosted` from the posting's structured data.
- A card can list several places (e.g. `Remote · Turkey, TX`); they are joined with ` · `.
- A removed posting returns 404, which `detail` reports as `NOT_FOUND`. A future `deadline` is the board's `validThrough`, often months out, so treat it as an upper bound, not an application deadline.
- The CLI retries 429/5xx with exponential backoff and jitter.
