---
name: gracklehq-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search games-industry jobs on Grackle
  HQ (gracklehq.com), a free aggregator that gathers postings daily from game
  studios' own careers pages - programmers, Unity or Unreal engineers, designers,
  artists, QA, production and more - worldwide or remote, or resolve a Grackle
  HQ job link to the studio's posting. Trigger phrases: Grackle, GrackleHQ, game
  industry jobs, game studio careers, remote game jobs, gamedev jobs, "which
  studios are hiring"; Spanish: empleos en estudios de videojuegos, trabajos de
  la industria de videojuegos, ofertas remotas de videojuegos.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/gracklehq-search/cli/src/cli.ts *)
---

# Grackle HQ Search Skill

Search the job list on [Grackle HQ](https://gracklehq.com), a non-profit site that checks
game studios' careers pages every day and lists their openings (around 2,500 at a time).
No authentication, no API key and **zero runtime dependencies**: it runs with just `bun`.

Grackle hosts **no posting text**: each job links through `/rd/<id>` to the studio's own
page (a Greenhouse, Lever or Workable board, the studio site, sometimes LinkedIn). `detail`
resolves that link so the posting can be fetched from its source.

## When to use this skill

- Search studio openings by title keyword, department, `Remote` or country
- Keep only recently listed jobs (`--jobage`)
- Turn a Grackle job id into the studio's posting URL

## Commands

### Search job listings

```bash
bun run .agents/skills/gracklehq-search/cli/src/cli.ts search [-q "<title words>"] [flags]
```

Query syntax: the board matches the query as one contiguous, case-insensitive substring of the job title only, so two words behave like an exact phrase with word order kept ("unity developer" 3 results, "developer unity" 0); quotes are dropped by the CLI (the board would treat them literally); the CLI then drops matches where the text only appears inside a longer word ("unity" in "Community"); no OR, no minus.

Flags:
- `--query <text>` / `-q <text>` - title substring, as above. Prefer short terms (`unity`, `gameplay`, `tools programmer`).
- `--location <text>` / `-l <text>` - `Remote` (Grackle's remote metro area), or a country as Grackle spells it: `USA`, `UK`, `Canada`, `Uruguay`, `Brazil`, `Mexico`... A country Grackle has no jobs for returns 0; the sidebar on gracklehq.com/jobs lists the countries it currently knows.
- `--department <text>` / `-d <text>` - `Engineering`, `Art`, `Design`, `Production`, `Quality Assurance`, `Business`, `IT`, `Audio`...
- `--jobage <days>` - first seen by Grackle within N days (client-side). Without `--page`, the CLI follows Next while the newest-first list is still inside the window, up to 5 pages.
- `--page <n>` - 1-indexed page, 30 results per page.
- `--limit <n>` / `-n <n>` - cap results emitted.
- `--format json|table|plain` - default `json`.

### Resolve a job to its posting

```bash
bun run .agents/skills/gracklehq-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the number from `search` (e.g. `384925`), or a `https://gracklehq.com/rd/<id>` URL.
Returns `postingUrl` (where the posting lives) and `postingHost`; `description` is always
`null`. Fetch `postingUrl` with the matching portal CLI (e.g. `linkedin-search detail`) or
WebFetch for the full text. The redirect is read, never followed.

## Usage examples

```bash
# Remote engineering roles listed in the last 14 days
bun run .agents/skills/gracklehq-search/cli/src/cli.ts search -d Engineering -l Remote --jobage 14 --format table

# Unity roles anywhere
bun run .agents/skills/gracklehq-search/cli/src/cli.ts search -q unity --format table

# Gameplay programmers, recent
bun run .agents/skills/gracklehq-search/cli/src/cli.ts search -q "gameplay programmer" --jobage 14

# Studios in Uruguay
bun run .agents/skills/gracklehq-search/cli/src/cli.ts search -l Uruguay --format table

# Where does job 384925 live?
bun run .agents/skills/gracklehq-search/cli/src/cli.ts detail 384925 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, passing `id` to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | A short list, or one resolved job |

Search JSON is `{ "meta": { "count", "page", "pagesRead", "total", "hasNext" }, "results": [...] }`;
each result has `id`, `title`, `company`, `location`, `date`, `dateText` and `url` (missing
values are `null`). `total` is the board's own count for the query before the CLI's
word-start filter. Errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit
code `1`.

## Notes

- `gracklehq.com/robots.txt` does not exist (404) and the site publishes no terms of use; its FAQ describes it as a free public service run at a loss, funded by donations. Be considerate: one search per term, `--jobage` paging capped at 5 pages with a 1-second pause between pages, and `detail` only for promising hits.
- `date` is derived from the card's age (`<1d`, `7d`, `652d`), which counts from when Grackle first saw the posting, not the studio's publication date. Old ages are common: Grackle keeps a job while it stays on the careers page.
- A job is listed once per location, so the same title can appear twice with different ids.
- The line under each title is `Company - Location`; the CLI splits on the last ` - `.
- Some titles arrive double-escaped (`&amp;amp;`); the CLI decodes them.
- `/rd/<id>` answers 302 to the posting; a removed job answers 404 (`NOT_FOUND`).
- The CLI retries 429/5xx with exponential backoff and jitter.
