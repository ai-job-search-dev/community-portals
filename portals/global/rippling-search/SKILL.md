---
name: rippling-search
version: 1.0.0
description: >
  Use this skill to search a company's public Rippling job board
  (ats.rippling.com/<company>/jobs) or to look up one of its postings. Rippling
  hosts the careers pages of many companies, so the board is chosen per call
  with --board. Trigger phrases: Rippling job board, Rippling careers,
  ats.rippling.com, jobs at <company> on Rippling, find open roles at <company>,
  search <company>'s careers page, look up this Rippling posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/rippling-search/cli/src/cli.ts *)
---

# Rippling Search Skill

Search the public job board that a company runs on **Rippling** — the ATS behind
careers pages at `https://ats.rippling.com/<company>/jobs`. One board per company,
any country. No authentication, no API key, and **zero runtime dependencies** — it
runs with just `bun`.

> **Per-company board.** Rippling is not one job market: each employer has its own
> board slug. Pass it with `--board` / `-b` (the first path segment of the
> company's Rippling careers URL). A company that does not use Rippling has no board here;
> search its own careers site instead.

## ⚠️ Undocumented vendor API

This skill reads the public **job-board API** at `ats.rippling.com`, the same data
the careers pages render. It is **not** the API documented at
[developer.rippling.com](https://developer.rippling.com/documentation/rest-api):
that one is Rippling's platform REST API (`rest.ripplingapis.com`), which is
token-authenticated and scoped to a company's own records (recruiting
requisitions, candidates, headcount) — it does not expose the public careers
board. The board API this skill uses has no published contract and can change
without notice. A failed request, or a board-level schema change, exits non-zero
with a clear error. Individual listing rows missing a title or a usable URL are
skipped, so an item-level field rename can still produce an empty search; if a
company you know is hiring returns nothing, check its careers page directly.
Keep volume low: a board search reads one listing page per 1,000 rows (up to 10)
plus one request per detail lookup, not a crawl.

Nothing here fills in or submits an application; this skill only reads postings.

## ⚠️ Personal use

These are public postings published for candidates, not a bulk data source.
Keep volume low (a handful of boards per search run), don't mirror or resell the
data, and run it on your own responsibility. If a company or Rippling blocks
automated access, stop — this skill does not work around it.

## When to use this skill

- Search a named company's Rippling board for a role, department, or location
- List everything a company currently advertises on Rippling
- Read one posting's full description, department, employment type and pay range
- Check whether a posting is still open (a closed posting's detail lookup returns 404)

## Commands

### Search a company's board

```bash
bun run .agents/skills/rippling-search/cli/src/cli.ts search --board <slug|url> [flags]
```

Query syntax: double and single quotes are stripped, so a quoted phrase matches its words in any order (not an exact phrase); no OR; every whitespace-separated term must appear (case-insensitive substring) in the title, department, or a location label. No operators.

Key flags:
- `--board <slug|url>` / `-b` — **required.** The board slug, e.g. `rippling`, or the company's Rippling careers URL, e.g. `https://ats.rippling.com/rippling/jobs`. Missing it exits 1 with `NO_BOARD`.
- `--query <text>` / `-q <text>` — optional keywords. The board API has no keyword search, so the CLI matches them itself (see the query syntax line above).
- `--page <n>` — 1-indexed page of the **filtered** results. Default 1.
- `--limit <n>` / `-n <n>` — results per page. Default 25.
- `--jobage <days>` — accepted for contract compatibility, but **the board API exposes no posting date**, so no posting-age filter is applied: the CLI prints a `JOBAGE_UNSUPPORTED` warning on stderr (exit stays 0). Do not rely on it for freshness; open a posting's detail (`date` is its `createdOn`) when the date matters.
- `--remote <modes>` — keep only postings whose workplace type matches: `remote`, `hybrid`, or `onsite` (`on-site` is accepted). Comma-separate for OR (`remote,hybrid`); a bare `--remote` means `remote`. The API has no such filter, so it is applied to each location's `workplaceType` after the rows are merged. A posting qualifies if **any** of its locations has the type, and its result still lists **all** of its locations, not only the matching one.
- `--format json|table|plain` — default `json`.

> **Pagination is client-side.** The CLI reads the board up to 10 pages of 1,000
> **listing rows**, merges the one-row-per-location duplicates into one posting
> per id (so `--query` matches the combined location labels), then filters and
> pages. A multi-location posting occupies one row per location, so the number of
> unique postings at the cap is lower than 10,000. `meta.total` is exact only
> when no `SEARCH_TRUNCATED` warning fires; when it fires, it counts matches
> among fetched rows and postings beyond that are never seen.

### Fetch one posting

```bash
bun run .agents/skills/rippling-search/cli/src/cli.ts detail <slug/id|url> [--board <slug>] [--format json|plain]
```

`<slug/id>` is the `id` from a search result, e.g.
`rippling/84d388b6-7656-434c-8862-0312eb6b97ac`. A full
`https://ats.rippling.com/<slug>/jobs/<id>` URL works too, and `--board <slug>`
lets you pass a bare posting id. Returns the cleaned full description (the
company blurb and the role text), department, employment type, pay ranges,
`createdOn` as `date`, and the locations.

Re-fetching a hit that `search` just returned adds what the listing lacks: the
full description, the employer's real name, `createdOn` as `date`, employment
type and pay ranges. Search results carry none of those.

## Usage examples

```bash
# Engineering roles at Rippling, table view
bun run .agents/skills/rippling-search/cli/src/cli.ts search --board rippling -q "engineer" --limit 10 --format table

# Everything a company advertises (board slug from its Rippling careers URL)
bun run .agents/skills/rippling-search/cli/src/cli.ts search --board just-appraised-jobs --format table

# A department/location filter, using the keyword matcher
bun run .agents/skills/rippling-search/cli/src/cli.ts search --board rippling -q "design remote" --format table

# Roles with a remote location, or with a remote or hybrid location
bun run .agents/skills/rippling-search/cli/src/cli.ts search --board rippling --remote remote --format table
bun run .agents/skills/rippling-search/cli/src/cli.ts search --board rippling --remote remote,hybrid --format table

# Next page of matches
bun run .agents/skills/rippling-search/cli/src/cli.ts search --board rippling -q "data" --page 2 --limit 25 --format table

# One posting's full detail
bun run .agents/skills/rippling-search/cli/src/cli.ts detail rippling/84d388b6-7656-434c-8862-0312eb6b97ac --format plain
```

## Finding the board slug

Open the company's careers page. If it lives on Rippling, its URL is
`https://ats.rippling.com/<slug>/jobs`; pass `<slug>` as `--board`. The slug is
usually the company name (`rippling`), but a company can choose a custom one
(`just-appraised-jobs`), so read it from the URL rather than guessing.

Because each board is one employer, a scrape needs a target list: give `/scrape`
the companies you care about and run this CLI once per board.

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use (`{ "meta": { "count", "page", "total" }, "results": [...] }`) |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single posting (`detail`) |

Each search result carries `id`, `title`, `company`, `company_slug`, `location`,
`locations`, `date`, `url` and `department`; missing values are `null`, never
omitted. `detail` adds `employment_type`, `salary` and `description`. All errors
are written to **stderr** as `{ "error": "...", "code": "..." }` and the process
exits with code `1`.

## Notes

- **`company` in search results is the board slug**, because Rippling's listing
  endpoint carries no company name. The `detail` payload does, so a posting's
  detail reports the employer's real name. This keeps a result usable for
  company+title deduplication without inventing a name.
- **`date` is `null` in search results.** The listing endpoint has no posting
  date; `detail` exposes `createdOn` (e.g. `2026-03-31`). Treat "no date" as
  unknown, not as stale.
- **One posting can have several locations.** The board API returns it once per
  location; the CLI merges those rows and joins the labels with ` · `, so a
  search result is one posting, not one row per city.
- **Location labels are as the board wrote them**, with the country appended when
  the label omits it and `Remote` added for remote locations.
- **Pay is a range, not a rate.** `salary` keeps its period when Rippling records
  one (`USD 185000–240000/year (US)`); compare pay only within one period.
- **robots.txt** for `ats.rippling.com` disallows only `/internal/`; the board
  and its API paths this skill uses are allowed. The skill stays on those paths:
  no crawl of the careers site, no application endpoints, no `/internal/`.
- The API retries 429/5xx with exponential backoff and honours `Retry-After`; an
  unreachable API exits non-zero with a clear message. Requests never follow a
  redirect off `ats.rippling.com`.
