---
name: workday-search
version: 1.0.0
description: >
  Use this skill to search an employer's Workday job board or look up one of its
  postings, when the employer's careers site runs on Workday
  (*.myworkdayjobs.com or *.myworkdaysite.com). Workday powers the career sites
  of thousands of large employers, so invoke this skill for "jobs at <company>",
  "does <company> have any <role> openings", or a posting link on a Workday
  domain — in any country. Trigger phrases: workday jobs, myworkdayjobs,
  workday careers, workday job search, jobs at <company>, <company> careers,
  <company> openings, search this company's jobs, look up this Workday posting.
  Not for boards that are not Workday: check the URL first.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/workday-search/cli/src/cli.ts *)
---

# Workday Search Skill

Search the live job postings of any employer whose careers site runs on
**Workday** — the platform behind `*.myworkdayjobs.com` and
`*.myworkdaysite.com`. No authentication, no API key, and **zero runtime
dependencies**: it runs with just `bun`.

Workday has **no global index**: each employer has its own board (a tenant,
instance and site), so every search names one. This skill searches that board
and reads its postings; it does not discover boards.

## ⚠️ Personal use only

This uses the public job API behind an employer's Workday careers site. Keep
volume low, do not bulk-collect, and run it on your own responsibility. The
employer's terms, Workday's site terms and the board's `robots.txt` apply: the
CLI requests only the board's `/wday/cxs/` endpoints and never crawls the
careers pages. If a board blocks automated access, stop.

## ⚠️ Undocumented endpoint

Workday's `/wday/cxs/` JSON is what its own careers pages load; it is not a
published, versioned API and can change without notice. Workday's documented
APIs at developer.workday.com are tenant-authenticated APIs for a customer's own
records; they do not expose a public, cross-company job board, so this portal
reads the unauthenticated JSON the careers pages load. A failed request exits
non-zero with a clear error, but an item-level field rename can still produce an
empty search — so if a board you know is hiring returns nothing, check its
careers page directly before trusting the empty result.

## When to use this skill

- Search an employer's Workday board by keyword, title, skill or place
- Filter by approximate posting age (today, last 7 / 14 / 30 days)
- Get the full description, posting date and location of one posting
- Check whether a specific Workday posting is still open (`canApply`) or gone

**Check the board first.** If the employer's careers page is not on a Workday
domain, this skill is the wrong tool — use the portal for whatever platform it
actually runs on (Greenhouse, Lever, LinkedIn, a local board). Do not guess a
Workday board URL; read it from the employer's careers page ("Search jobs" /
"View openings" links usually point at `myworkdayjobs.com`).

## Commands

### Search job listings

```bash
bun run .agents/skills/workday-search/cli/src/cli.ts search --board "<board>" [--query "<text>"] [flags]
```

Query syntax: phrase quoting not honoured; no documented boolean or exclusion operators — the text is passed unchanged to Workday's own keyword search, which matches the terms it recognises.

Key flags:
- `--board <board>` / `-b <board>` — **required.** The employer's Workday board, as
  - its careers URL: `https://<tenant>.wdN.myworkdayjobs.com/<site>` (an optional
    `/en-US/` locale segment is fine), or
  - a myworkdaysite URL: `https://wdN.myworkdaysite.com/recruiting/<tenant>/<site>`
    (an optional locale may precede `/recruiting/`), or
  - the bare triple `<tenant>/<instance>/<site>`, e.g. `nvidia/wd5/NVIDIAExternalCareerSite`.
- `--query <text>` / `-q <text>` — keyword search (title, skill, place). Optional;
  without it the board lists all its postings.
- `--page <n>` — page number (1-indexed, 20 results per page, fixed). Workday
  serves at most 2,000 postings per query, so page 100 (offset 1,980) is the
  deepest; a deeper page fails with `PAGE_LIMIT`. Narrow `--query` instead.
  Some boards repeat page 1 when you page past their end below 2,000, so stop
  at the `meta.total` reported by page 1 or when the results repeat.
- `--jobage <days>` — keep postings **on the fetched page** dated within N days.
  Workday reports only relative ages ("Posted 7 Days Ago"), so this is
  day-granular, and postings in the unbounded "30+ Days Ago" bucket are dropped.
- `--limit <n>` / `-n <n>` — cap the results this call prints (client-side).
- `--format json|table|plain` — default `json`.

Every option is single-value: repeating one (or mixing a short and long spelling,
e.g. `-q a --query b`) exits `BAD_ARG` rather than silently searching one value.

> **Location**: Workday's location filter is a per-board facet with opaque IDs,
> so this CLI does not expose it. Put a place in `--query` (it often helps rank
> local roles) and filter the `location` field client-side. Multi-location
> postings show a placeholder like `"2 Locations"` in search; `detail` resolves
> the real places.

### Fetch full job detail

```bash
bun run .agents/skills/workday-search/cli/src/cli.ts detail <job-url> [--format json|plain]
```

`job-url` is the `id` (same as `url`) from a search result, e.g.
`https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506`.
A URL on any other host, or a path that is not a `/job/...` posting, is rejected
with `BAD_ID` before any request. Returns the full description, the start date
when the board provides one (otherwise an approximate date), deadline when the
board sets one, employment type, every listed location, and `canApply` (whether
the board still accepts applications).

---

## How to use effectively

**Always start with `search`.** Two steps are usually enough:

1. Find the board URL on the employer's careers page, and search it.
2. Call `detail` with a shortlisted result's `url` only when you need the full ad.

**Narrow by keyword, not by location flag.** `--query "data engineer austin"`
works well; then read `location` in the results.

**No sort flag.** Workday returns its own order: an empty query looked
newest-first, but a keyword search interleaved "30+ Days Ago" results ahead of
newer ones. Do not assume page 1 is the freshest slice.

**`--jobage` filters the page fetched, not the whole board.** A recent posting
can sit on a later page, especially for keyword searches, so page through (or
narrow `--query`) when recency matters. Search dates are derived from relative
labels; `detail` prefers the exact `startDate` and falls back to a relative
label. Undated "30+ Days Ago" postings are dropped whenever `--jobage` is set.

**`meta.total` can cap at 2,000.** Some Workday tenants report 2,000 for larger
boards and repeat page 1 past that offset; the CLI refuses pages beyond it
rather than printing duplicates. A deep page can also report 0 while returning
rows; the CLI never reports a total lower than the rows it returned. On a
smaller board, paging past its end can repeat page 1, so stop at the total
reported by page 1 or when the results repeat.

**Table for scanning, JSON for ids.** The table shows the requisition tail
instead of the full URL; the JSON `id`/`url` is what `detail` accepts.

---

## Usage examples

### Software engineer roles at NVIDIA

```bash
bun run .agents/skills/workday-search/cli/src/cli.ts search \
  --board nvidia/wd5/NVIDIAExternalCareerSite \
  --query "software engineer" \
  --format table
```

### Salesforce product roles from the careers URL, last 14 days

```bash
bun run .agents/skills/workday-search/cli/src/cli.ts search \
  --board "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site" \
  --query "product manager" \
  --jobage 14 \
  --format table
```

### Page 2 of a board-wide listing

```bash
bun run .agents/skills/workday-search/cli/src/cli.ts search \
  --board acme/wd3/AcmeCareers \
  --page 2 \
  --format json
```

### Full details for a specific posting

```bash
bun run .agents/skills/workday-search/cli/src/cli.ts detail \
  "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506" \
  --format plain
```

---

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, reading `id`/`url` for `detail` |
| `table` | Quick human-readable overview and scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "total", "page", "perPage" }, "results": [...] }`;
each result has `id`, `title`, `company`, `location`, `date`, `url`, and
`description` (always `null` in search — use `detail`). All errors are written
to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with
code `1`.

---

## Notes

- Data is the board's public JSON API — no credentials required.
- `company` in search is the board's tenant slug; `detail` reports the hiring
  organisation's own name when the board exposes one.
- Page size is fixed at 20. `meta.total` is the board's own count for the query.
- `date` is approximate in search (derived from "Posted N Days Ago"). `detail`
  prefers the exact `startDate` and falls back to the relative `postedOn` label
  when `startDate` is missing or invalid, so a detail date is not always exact.
  Both are `YYYY-MM-DD` or `null`.
- Retries 429/5xx with exponential backoff. A retired or restricted board
  commonly answers `401`, `403` or `422`; the CLI names the board URL to check.
- Search only: this skill reads postings and never applies to them.
