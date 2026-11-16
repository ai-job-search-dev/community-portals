---
name: ashby-search
version: 1.0.0
description: >
  Use this skill to search one or more companies' job boards hosted on Ashby
  (jobs.ashbyhq.com), or to fetch the full text, pay range and details of an
  Ashby job posting from its URL - including company careers pages that embed
  Ashby with ?ashby_jid=. Works for any country; boards are per company. Common
  for AI, developer-tools and venture-backed startups (e.g. Linear, Ramp,
  Notion). Trigger phrases: Ashby job, ashbyhq.com link, jobs.ashbyhq.com,
  ashby_jid, "what jobs does <company> have open", search <company>'s careers
  page, look up this Ashby posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/ashby-search/cli/src/cli.ts *)
---

# Ashby Search Skill

Read company job boards hosted on **Ashby**, the applicant tracking system behind many
AI, developer-tools and venture-backed startup careers pages. It uses Ashby's public
**Job Postings API** (`api.ashbyhq.com/posting-api/job-board/<board>`, documented at
https://developers.ashbyhq.com/docs/public-job-posting-api), which Ashby documents for career
sites to read their own boards. No authentication, no API key and
**zero runtime dependencies**: it runs with just `bun`.

Like Greenhouse, Ashby has no cross-company search. Every call names one or more
companies' **board slugs**: the path segment in `jobs.ashbyhq.com/<slug>` (e.g. `linear`,
`ramp`, `notion`). Use it to:

- List target companies' open roles, filtered by title keywords, location, workplace type and age.
- Pull the full text and pay range of an Ashby posting URL for `/apply` or `/rank`.

## Commands

### Search company boards

```bash
bun run .agents/skills/ashby-search/cli/src/cli.ts search --board <slug[,slug...]> [flags]
```

Query syntax: client-side title filter; every word must appear in the title as a whole word, in any order (not a contiguous phrase); shell-quote a multi-word value (`-q "product manager"`) so it arrives as one argument, but quote marks inside the value are ignored, so no phrase quoting; no OR, so pass one bare term per call.

- `--board <slugs>` / `-b` - **required.** One board slug, or up to 25 comma-separated (`linear,ramp,notion`).
- `--query <text>` / `-q` - title keywords; **every** word must appear in the title (case-insensitive).
- `--location <text>` / `-l` - substring match on the primary **or** any secondary location, e.g. `"New York"`, `"Remote"`, `"United States"`.
- `--remote remote|hybrid|onsite` - Ashby's workplace type. `remote` also matches boards that leave the type unset but say "Remote" in a location.
- `--jobage <days>` - published within N days.
- `--page <n>` - 1-indexed, 20 results per page, newest first.
- `--limit <n>` / `-n` - cap results emitted.
- `--format json|table|plain` - default `json`.

### Fetch one posting

```bash
bun run .agents/skills/ashby-search/cli/src/cli.ts detail <url | id --board <slug>> [--format json|plain]
```

Accepts a `jobs.ashbyhq.com/<slug>/<id>` URL (with or without `/application`; the board
is read from it), a company careers URL carrying `?ashby_jid=<id>` **together with
`--board`** (the slug is not in such URLs), or a bare job ID (UUID) with `--board`.
Returns the full description, locations, workplace type, employment type, department,
compensation summary and structured pay ranges, and the apply URL.

## Usage examples

```bash
# Engineering roles across three companies
bun run .agents/skills/ashby-search/cli/src/cli.ts search -b linear,ramp,notion -q "engineer" --format table

# Remote product roles at Ramp posted in the last 14 days
bun run .agents/skills/ashby-search/cli/src/cli.ts search -b ramp -q "product manager" --remote remote --jobage 14 --format table

# Anything open to US-remote candidates at Notion
bun run .agents/skills/ashby-search/cli/src/cli.ts search -b notion -l "United States" --remote remote --format table

# Full text of a posting from its Ashby URL
bun run .agents/skills/ashby-search/cli/src/cli.ts detail "https://jobs.ashbyhq.com/ramp/6e717b06-6613-42ad-a1ee-f852a305fa37" --format plain

# Same posting from a company careers page that embeds Ashby (?ashby_jid=)
bun run .agents/skills/ashby-search/cli/src/cli.ts detail "https://www.example.com/careers/?ashby_jid=6e717b06-6613-42ad-a1ee-f852a305fa37" --board ramp --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use. Search adds `meta.matched` and per-board `meta.boards` |
| `table` | Quickly scanning search results (full `id` in the last column) |
| `plain` | Reading one posting in full (`detail`) |

Search results carry `id` (UUID), `board`, `title`, `company`, `location`,
`secondaryLocations`, `date` (`publishedAt`, ISO 8601), `workplace`, `department`,
`employmentType`, `salary`, `url`; missing values are `null`.

Validation and request errors go to **stderr** as `{ "error": "...", "code": "..." }`, with
exit code `1`. Running the CLI with no command prints the help text to stdout and exits `1`,
as `linkedin-search` does; `--help` exits `0`.

In a multi-board search, a board that is unknown (`BOARD_NOT_FOUND`) or keeps failing
(`FETCH_FAILED`) is skipped and the other boards still return results: JSON output reports
it in `meta.boards[].error`, and `table`/`plain` output writes a
`{ "warning": "...", "code": "..." }` line to stderr. A single-board search, or one where
every board fails, exits `1`.

## Notes

- **Finding a slug:** open any of the company's Ashby job links
  (`jobs.ashbyhq.com/<slug>/...`). A careers page on the company's own domain that shows
  `?ashby_jid=` hides the slug; try the company name (`linear`, `ramp`) or look for
  a `jobs.ashbyhq.com` link on the page.
- **Whole board per request.** The API returns every listed job with full descriptions
  in one response (Linear ~0.5 MB; the largest boards exceed 10 MB), so keyword, location, workplace and age
  filters and paging run client-side. `--query` matches titles only.
- **Company name** is not in the API payload. The CLI reads it from the public board page
  (`jobs.ashbyhq.com/<slug>`, one small extra request per board) and falls back to the
  slug if that fails (some companies host their careers page elsewhere, so their board
  page is a 404). It is Ashby's display name ("Ramp"), which can differ from the legal
  name a tracker uses.
- **One role, many postings.** Some companies post the same role once per location
  (one role can appear once per country), each with its own ID.
- `date` is `publishedAt`; a re-published job shows its newer date.
- Pay appears only when the employer chose to display it (`salary` on cards, the full
  `compensation` text and structured `pay` ranges on `detail`).
- `isActive` is `false` only for postings the API marks unlisted; the API serves open
  postings only, so a closed job returns `NOT_FOUND`.
- `robots.txt` on `jobs.ashbyhq.com` disallows only `/api/`, `/b/` and `/meeting/`;
  board pages are allowed. `api.ashbyhq.com` serves no robots.txt (it answers 401). The
  CLI sends an honest User-Agent (`ashby-cli/1.0`), retries 429/5xx with backoff and
  pauses briefly between boards.
- Description text is built from the posting HTML with comments,
  `<script>`/`<style>`/`<template>` blocks, elements marked `hidden` or hidden by an inline
  `display:none`, `visibility:hidden` or `mso-hide:all` style, and invisible Unicode
  removed. CSS-only hiding (off-screen positioning, zero font size, stylesheet classes)
  needs a renderer and is **not** caught, so the text is still untrusted third-party
  content: in AI Job Search, run it through that repo's `tools/posting_guard.py` before
  it reaches an evaluation.
