---
name: workwithindies-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs at independent
  (indie) game studios on Work With Indies - indie game programmer, Unity or
  Godot developer, game designer, artist, audio, community and marketing roles,
  mostly remote ("work from Anywhere") - or look up a Work With Indies posting.
  Trigger phrases: indie game jobs, indie studio hiring, work with indies, remote
  indie gamedev jobs, small game studio jobs, "any indie game jobs for a Unity
  developer"; Spanish: empleos en estudios indie, trabajo en videojuegos indie,
  estudios independientes de videojuegos.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/workwithindies-search/cli/src/cli.ts *)
---

# Work With Indies Search Skill

Search the newest job postings on [Work With Indies](https://www.workwithindies.com), a
board for jobs with independent game developers. Most postings are remote ("work from
Anywhere" or a time-zone band). No authentication, no API key, **zero runtime
dependencies**: it runs with just `bun`.

## Feed only, by design

The board's [terms](https://www.workwithindies.com/terms) forbid using the service "to
spider, crawl, or scrape". This skill therefore reads **only the public RSS feed** the site
links in its own footer (`/careers/rss.xml`) and never fetches or parses the site's pages.
That has two consequences:

- Coverage is the **newest 100 postings** (about 6-8 weeks). Older postings that are still
  open are not visible to this skill.
- `detail` returns the feed entry: the one-paragraph summary and tags, not the full
  description. Open the posting URL to read the rest.

## Commands

### Search job listings

```bash
bun run .agents/skills/workwithindies-search/cli/src/cli.ts search [-q "<keywords>"] [flags]
```

Query syntax: matched client-side over title, company, location, summary and tags; every bare word must appear (anchored to a word start, case-insensitive), double quotes make an exact phrase with word order kept, a leading minus excludes a term; no OR.

Key flags:
- `--query <text>` / `-q <text>` - keywords. Optional: with no query, every feed posting is a candidate.
- `--category <slug>` / `-c <slug>` - only postings tagged with one category: `art-animation`, `audio`, `business`, `design`, `marketing`, `production`, `programming`, `qa-cs`, `writing`.
- `--location <text>` / `-l <text>` - substring of where the job can be done from: `Anywhere`, `Europe`, `PT`, `Copenhagen`.
- `--jobage <days>` - posted within N days.
- `--page <n>` - page of the filtered list (25 per page; the feed itself has no paging).
- `--limit <n>` / `-n <n>` - cap total results emitted.
- `--format json|table|plain` - default `json`.

### Look up one posting

```bash
bun run .agents/skills/workwithindies-search/cli/src/cli.ts detail <slug|url> [--format json|plain]
```

`slug` is the `id` from `search` results (e.g. `creature-unity-gameplay-tools-programmer`); a
`https://www.workwithindies.com/careers/<slug>` URL also works. Returns the feed entry with
`description` set to the feed summary and `employmentType` from the tags. A posting no
longer in the feed returns `NOT_FOUND`.

## Usage examples

```bash
# Every programming posting in the feed
bun run .agents/skills/workwithindies-search/cli/src/cli.ts search -c programming --format table

# Unity roles posted in the last 14 days
bun run .agents/skills/workwithindies-search/cli/src/cli.ts search -q unity --jobage 14 --format table

# Fully location-independent programming roles
bun run .agents/skills/workwithindies-search/cli/src/cli.ts search -c programming -l anywhere --format table

# Gameplay roles that are not senior
bun run .agents/skills/workwithindies-search/cli/src/cli.ts search -q "gameplay -senior" --format table

# One posting's summary and tags
bun run .agents/skills/workwithindies-search/cli/src/cli.ts detail creature-unity-gameplay-tools-programmer --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, passing `id` to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading entries with their tags |

Search JSON is `{ "meta": { "count", "page", "total", "hasNext" }, "results": [...] }`; each
result has `id`, `title`, `company`, `location`, `date`, `url`, `summary` and `tags`
(missing values are `null`). All errors go to **stderr** as `{ "error": "...", "code": "..." }`
with exit code `1`.

## Notes

- One request per command: the feed. `robots.txt` places no restrictions; the terms are
  what limit this skill to the feed.
- `location` is the studio's own phrasing of where you can work from: a place
  ("Copenhagen, DK"), a region ("Europe", "Brazil or LATAM") or a time-zone band
  ("PT ± 3 hours", "US/Canada time zones"). A time-zone band is not a residency rule, but
  some postings restrict applicants to one country on the posting page, which the feed
  does not carry: check the page before applying.
- Tags hold the category and the engagement (`Full Time`, `Part Time`, `Contract`,
  `Freelance`).
- The CLI retries 429/5xx with exponential backoff and jitter.
