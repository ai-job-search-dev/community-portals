---
name: remotegamejobs-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for remote jobs in the video
  game industry on Remote Game Jobs (remotegamejobs.com) - remote game programmer,
  Unity or Unreal developer, gameplay or multiplayer engineer, game designer,
  artist, producer, QA and community roles - or look up a Remote Game Jobs
  posting and its remote scope (who may apply from where). Trigger phrases:
  remote game jobs, remote gamedev jobs, work from home game studio jobs,
  remote Unity jobs, remote game programmer jobs; Spanish: trabajo remoto en
  videojuegos, empleos remotos de videojuegos, desarrollador de videojuegos remoto.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/remotegamejobs-search/cli/src/cli.ts *)
---

# Remote Game Jobs Search Skill

Search live postings on [Remote Game Jobs](https://remotegamejobs.com), a remote-only job
board for the games industry. Every posting is remote; each one states its **remote
scope** (e.g. "Worldwide", "Remote Europe", "Must be based in the province of Quebec,
Canada"), which this skill returns as `location`. No authentication, no API key, **zero
runtime dependencies**: it runs with just `bun`.

## ⚠️ Personal use only

The board's [terms](https://remotegamejobs.com/terms) license its content "for your
information and personal use only" and for "personal, non-commercial use". Use this skill
for your own job search, keep volume low (one search per term, details only for promising
postings), and don't use it commercially or to collect data in bulk.

## Commands

### Search job listings

```bash
bun run .agents/skills/remotegamejobs-search/cli/src/cli.ts search -q "<keywords>" [flags]
```

Query syntax: every word must match (searched server-side in the full posting text); quotes are ignored, so there is no exact phrase; OR is treated as a plain word, not a union; a leading minus does not exclude (`-mobile` matches like `mobile`).

Key flags:
- `--query <text>` / `-q <text>` - keywords, matched against the whole posting. Recommended.
- `--category <slug>` / `-c <slug>` - one category: `programming`, `design`, `art-and-animation`, `production`, `quality-assurance`, `community-management`, `sales-marketing`, `music-sound-design`, `writing`, `voice-acting`, `business-analysis`. With `--query`, the two lists are intersected.
- `--location <text>` / `-l <text>` - substring of the remote scope: `worldwide`, `europe`, `canada`, `utc`.
- `--jobage <days>` - posted within N days. Dates come from the board's RSS feed (cards carry none); postings older than the feed are undated and kept for any N, so `--jobage` narrows the dated postings only.
- `--limit <n>` / `-n <n>` - cap total results emitted.
- `--format json|table|plain` - default `json`.

No `--page`: the board is small (a few dozen live postings) and returns every match on one page.

### Fetch full job detail

```bash
bun run .agents/skills/remotegamejobs-search/cli/src/cli.ts detail <slug|url> [--format json|plain]
```

`slug` is the `id` from `search` results (e.g. `skymap-games-multiplayer-engineer-unity-remote-job`);
a `https://remotegamejobs.com/jobs/<slug>` URL also works. Returns the full description, the
remote scope, `applicantLocation` (the posting's structured applicant-country rule),
type and level, salary, posted and valid-through dates, and the apply link.

## Usage examples

```bash
# Unity roles
bun run .agents/skills/remotegamejobs-search/cli/src/cli.ts search -q unity --format table

# Every open programming role, with its remote scope
bun run .agents/skills/remotegamejobs-search/cli/src/cli.ts search -c programming --format table

# Programming roles open worldwide, posted in the last 14 days
bun run .agents/skills/remotegamejobs-search/cli/src/cli.ts search -c programming -l worldwide --jobage 14 --format table

# Backend roles in programming
bun run .agents/skills/remotegamejobs-search/cli/src/cli.ts search -q backend -c programming --format plain

# One posting in full
bun run .agents/skills/remotegamejobs-search/cli/src/cli.ts detail skymap-games-multiplayer-engineer-unity-remote-job --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, passing `id` to `detail` |
| `table` | Quick scanning with remote scopes side by side |
| `plain` | Reading entries with category, type, level and salary |

Search JSON is `{ "meta": { "count", "page", "total", "hasNext" }, "results": [...] }`. The board
has no paging, so `page` is always 1 and `hasNext` always `false`; `count` below `total` means
`--limit` cut the list. When the RSS feed fails and `--jobage` is not set, the search still
succeeds with `date: null` everywhere, `meta.feedError` says why, and stderr carries a
`FEED_UNAVAILABLE` warning; with `--jobage` the dates are required, so the search fails. Each
result has `id`, `title`, `company`, `location` (remote scope), `date`, `url`, `category`,
`tags` and `salary` (missing values are `null`). All errors go to **stderr** as
`{ "error": "...", "code": "..." }` with exit code `1`.

## Notes

- **Read the remote scope before applying.** "Remote" here rarely means "from anywhere":
  many postings restrict applicants to a country, province or time-zone band. `detail`
  also returns the structured `applicantLocation`.
- `robots.txt` disallows only `/goto/` (the apply redirect). The skill prints that link for
  you to open and never requests it.
- A search makes at most three requests, not counting retries on 429/5xx: the search or
  category page (both when combined) and the RSS feed for dates. The feed is skipped when
  nothing matched.
- The CLI retries 429/5xx with exponential backoff and jitter.
