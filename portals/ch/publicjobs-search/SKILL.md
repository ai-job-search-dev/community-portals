---
name: publicjobs-search
version: 1.0.0
description: >
  Use this skill to search publicjobs.ch, the Swiss job board for the public and
  non-profit sector: cantonal and federal administrations, cities and municipalities,
  public schools, hospitals and clinics, care homes, churches and foundations, mostly in
  German-speaking Switzerland - or to fetch one posting from it. Invoke for jobs at a
  Kanton, Stadt or Gemeinde, cantonal statistics offices, tax and IT departments of the
  administration, public hospitals and schools. Trigger phrases: public sector jobs
  Switzerland, government jobs Zurich/Lucerne/Schwyz, canton jobs, municipality jobs,
  publicjobs, öffentliche Verwaltung Stellen, Stellen Kanton, Stellen Gemeinde,
  Stellen Stadt Zürich, Jobs öffentlicher Dienst Schweiz, Verwaltungsjobs,
  Stellenangebote Kanton Schwyz/Luzern/Zug.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/publicjobs-search/cli/src/cli.ts *)
---

# publicjobs.ch Search

Searches [publicjobs.ch](https://publicjobs.ch), a Swiss job board for public-sector and
non-profit employers (about 1,800 open postings on 2026-11-25). Nearly all are in
German-speaking cantons, and almost half are in Zürich. Clinical, teaching and social-work
posts make up over half, so search with a `--query` or `--category`.
There's no authentication and no runtime dependencies; it runs with `bun` alone.

**How it gets the data:** the site's keyword search works only through a form POST, so this
CLI doesn't use it. `search` reads the public `sitemap.xml`, which lists every open posting,
and filters it locally. `detail` reads the posting's SvelteKit `__data.json`. Both are
plain GETs on paths `robots.txt` permits. The site's terms (AGB of Swiss Public Services AG,
`publicjobs.ch/ueber-uns/agbs`, read 2026-11-25) cover advertisers and job seekers and contain
no clause on automated access or reuse. Keep volume low anyway: a search is one sitemap
request (cached 30 minutes), and a detail is one or two small requests.

## Commands

### Search

```bash
bun run .agents/skills/publicjobs-search/cli/src/cli.ts search [flags]
```

Query syntax: client-side filter on the title as it appears in the posting's URL slug; every word must appear (case- and umlaut-insensitive substring, so `Zürich`, `Zuerich` and `Zurich` are the same); double quotes inside the argument make an exact phrase, word order included; single quotes are dropped like other punctuation, so a single-quoted query behaves like the bare words; no OR (it is just another word).

The slug is the only title text in the sitemap. It is lowercase, with umlauts spelled out
(`ae`, `oe`, `ue`), and **long titles are truncated** (slugs end at 150 characters, often
mid-word). Words near the end of a long title may therefore not match. `detail` has the
full title.

Flags:
- `--query`, `-q <text>`: the filter above. Optional; without it you get every open posting.
- `--location`, `-l <canton>`: canton name (German, `Zürich`), English spelling (`Zurich`), slug (`zuerich`) or two-letter code (`ZH`). Two-letter values match codes only. Location means the canton: the sitemap has no city, so pass a canton here rather than a city in `--query`.
- `--category`, `-c <text>`: substring of the site's category label, e.g. `informatik`, `Finanzen`, `Kaufmännisch`. The 21 labels are listed in `url-reference.md`.
- `--page <n>`: 1-indexed page of the results, 20 per page, highest posting id first.
- `--limit`, `-n <n>`: caps the results emitted (client-side, within the page).
- `--format json|table|plain`: defaults to `json`.

**There is no `--jobage`.** The sitemap carries no posting date, since its `<lastmod>` is a
batch refresh stamp. Passing `--jobage` exits 1 with `UNSUPPORTED_FLAG` rather than
being silently ignored. Results come highest id first, and ids grow as postings are
created, so new postings are at the top. `date` is `null` in search results; `detail`
gives the publication date.

### Detail

```bash
bun run .agents/skills/publicjobs-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric `id` from `search` (e.g. `168023`), or a posting URL on publicjobs.ch
(`/jobs/...` or `/fr/jobs/...`). Any other host is rejected without a request. The output
contains `title`, `company` (the employer), `organisationType` (e.g. `Bund und Kantone`,
`Gemeinden und Städte`), `location` (city and canton code), `category`, `careerLevel`,
`workload`, `date` (publication), `created`, `listingEnd`, `contactName`, `lead`, the full
`description` as plain text, `applyUrl` and `url`. Contact e-mail and phone are left out.

## Usage examples

```bash
# Statistics and data roles, anywhere
bun run .agents/skills/publicjobs-search/cli/src/cli.ts search -q statistik --format table
bun run .agents/skills/publicjobs-search/cli/src/cli.ts search -q data --format table

# Everything in IT at the canton and municipalities of Schwyz
bun run .agents/skills/publicjobs-search/cli/src/cli.ts search -c informatik -l SZ --format table

# Analyst roles in the canton of Zürich
bun run .agents/skills/publicjobs-search/cli/src/cli.ts search -q analy -l Zürich

# Newest 10 postings in Luzern
bun run .agents/skills/publicjobs-search/cli/src/cli.ts search -l luzern -n 10 --format plain

# Full text of one posting
bun run .agents/skills/publicjobs-search/cli/src/cli.ts detail 168023 --format plain
```

## Output

`search --format json` prints `{ "meta": { "count", "page", "total", "numPages", "listed" }, "results": [...] }`.
`total` is the number of matches, and `listed` is the number of postings in the sitemap. Each
result has `id`, `title` (from the slug), `company` (always `null`), `location` (canton
name), `canton` (code), `category`, `date` (always `null`), `url` and `slug`. A missing
value is `null`, never omitted.

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, passing `id` to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Errors go to **stderr** as `{ "error": "...", "code": "..." }`, with exit code `1`
(`SEARCH_FAILED`, `NOT_FOUND`, `BAD_ID`, `BAD_ARG`, `UNKNOWN_FLAG`, `UNSUPPORTED_FLAG`).

## Notes

- **Dates.** `listingEnd` is when the ad goes offline, not the application deadline; read the
  posting text for that. `date` is `publicFrom`, which can be a re-publication: an
  employer can re-publish an old posting, so `date` can be much later than `created`.
- **Workload.** `workload` is the portal's structured field and can disagree with the title
  ("80-100%" in the title, `100 %` in the field). The title is what the employer wrote.
- **Description.** Some employers' templates carry tab labels ("Die Stelle Über uns Benefits
  Kontakt") that end up in the text. That is the employer's markup, not a parsing error.
- **Language.** Postings are German. The French site (`/fr/`) shows the same postings with
  translated paths, so the CLI skips them.
- **Coverage.** Postings outside German-speaking Switzerland exist (Freiburg, Tessin, Wallis,
  `Schweiz` for nationwide ones). Filter them with `--location` or after the call.
- **Cache.** `PUBLICJOBS_CACHE_TTL=<seconds>` changes the 30-minute sitemap cache (0 disables
  it), and `PUBLICJOBS_CACHE_DIR` moves it (default: the OS temp dir). Detail payloads are
  never cached.
- **Not used.** The `/jobs?/jobSearch` form POST (server-side keyword search, paging, full
  records), and GET `?city=`/`?category=` on `/jobs/__data.json`, which filters server-side
  but always returns only the first 24 rows.
