---
name: lever-search
version: 1.0.0
description: >
  Use this skill to search a specific company's job board hosted on Lever
  (jobs.lever.co / jobs.eu.lever.co), or to fetch the full text, pay range and
  details of a Lever posting from its URL. Works for any country; boards are per
  company. Trigger phrases: Lever job, lever.co link, jobs.lever.co, "what jobs
  does <company> have open", search <company>'s careers page, look up this Lever
  posting, fetch this job posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/lever-search/cli/src/cli.ts *)
---

# Lever Search Skill

Read company job boards hosted on **Lever**, the applicant tracking system behind
thousands of company careers pages. It uses Lever's public **Postings API**
(`api.lever.co/v0/postings`, documented at https://github.com/lever/postings-api),
which Lever publishes for reading job boards: its GET endpoints need no authentication.
No API key and **zero runtime dependencies**: it runs with just `bun`.

Unlike a job aggregator, Lever has no cross-company search. Every call names one
company's **board slug**: the path segment in `jobs.lever.co/<slug>/<uuid>`
(e.g. `leverdemo`, `palantir`). Use it to:

- Pull the full text and pay range of a Lever posting URL. `/apply` gets it this
  way, since WebFetch only summarizes these pages.
- List a target company's open roles, filtered by title keywords, location and age.

## Commands

### Search one company's board

```bash
bun run .agents/skills/lever-search/cli/src/cli.ts search --board <slug> [flags]
```

Query syntax: client-side title filter; every whitespace-separated word must appear in the title as a substring, in any order (not a contiguous phrase); shell-quote a multi-word value (`-q "product manager"`) so it arrives as one argument, but quote characters inside the value become part of a word and match nothing, so no phrase quoting; no OR, so pass one bare term per call.

- `--board <slug>` / `-b` — **required.** Company board slug, e.g. `leverdemo`.
- `--query <text>` / `-q` — title keywords; **every** word must appear in the title (case-insensitive).
- `--location <text>` / `-l` — substring match on the posting's location (all listed locations, plus `Remote` for remote postings), e.g. `"Remote"`, `"Austin"`, `"Germany"`.
- `--remote remote|hybrid|onsite` — client-side workplace filter. Lever has no server-side `workplaceType` parameter; `onsite` matches both `onsite` and `on-site`, and a posting with no type matches `remote` only when its location says Remote.
- `--jobage <days>` — created within N days.
- `--page <n>` — 1-indexed, 20 results by default, newest first.
- `--limit <n>` / `-n` — results per page; also caps what is emitted. Paging steps by this size.
- `--region us|eu` — Lever data region (default `us`; EU boards live on `*.eu.lever.co`).
- `--format json|table|plain` — default `json`.

### Fetch one posting

```bash
bun run .agents/skills/lever-search/cli/src/cli.ts detail <url | id --board <slug>> [--region us|eu] [--format json|plain]
```

Accepts a `jobs.lever.co` or `jobs.eu.lever.co` posting URL (board and region are
read from it), the API URL form, or a posting UUID with `--board`; an EU board's
bare UUID also needs `--region eu`. Returns the full description, department,
team, employment type, country, posted date, pay range and apply URL.

## Usage examples

```bash
# Customer success roles at Lever's demo board, as a table
bun run .agents/skills/lever-search/cli/src/cli.ts search -b leverdemo -q "customer success" --format table

# Product roles posted in the last 14 days
bun run .agents/skills/lever-search/cli/src/cli.ts search -b leverdemo -q "product" --jobage 14 --format table

# Anything remote on a company's board
bun run .agents/skills/lever-search/cli/src/cli.ts search -b leverdemo -l "Remote" --format table

# Remote-only roles, using the normalized workplace field
bun run .agents/skills/lever-search/cli/src/cli.ts search -b leverdemo --remote remote --format table

# Full text of a posting from its URL
bun run .agents/skills/lever-search/cli/src/cli.ts detail "https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b" --format plain

# Same posting by ID
bun run .agents/skills/lever-search/cli/src/cli.ts detail ad208490-4052-4f91-a57e-433f2d1e484b --board leverdemo --format json
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use. Search adds `meta.matched` and `meta.boardTotal` |
| `table` | Quickly scanning search results |
| `plain` | Reading one posting in full (`detail`) |

Validation and request errors go to **stderr** as `{ "error": "...", "code": "..." }`, with exit code `1`.
Running the CLI with no command prints the help text to stdout and exits `1`; an explicit
`--help`/`-h` (alone or after `search`/`detail`) exits `0`.

## Notes

- **Per-company boards only.** To find the slug, open any of the company's Lever job
  links (`jobs.lever.co/<slug>/...`). Some careers pages embed Lever behind their own
  domain; look for a `jobs.lever.co` link or try the company name.
- The board endpoint returns the **whole board**, so keyword, location and age
  filtering and paging happen client-side. It is read 100 postings at a time with
  `limit`/`skip` so one large board does not arrive as a single huge response.
  `--query` matches titles only; it does not search descriptions.
- **Company name:** Lever's payload carries no company display name, so `company`
  is the board slug. That is the same value every call already names.
- `location` merges `categories.location` with `categories.allLocations`, so a role
  open in several cities lists them all. A posting with `workplaceType: "remote"`
  also gets `Remote` appended when no location already says it.
- `date` is `createdAt` (epoch milliseconds in the API, ISO 8601 in the output).
- Pay appears only when the employer publishes `salaryRange`. The CLI keeps Lever's
  own `interval` (`per-year-salary`, `per-month-salary`, `per-hour-wage`, ...) rather
  than annualizing, so the number says what the posting says.
- A closed or removed job returns `NOT_FOUND`; Lever returns 404 for both an unknown
  board and an unknown posting, and `detail` cannot tell them apart.
- `robots.txt` on `api.lever.co` and `api.eu.lever.co` allows `/` with
  `Crawl-delay: 1`; those API hosts are the only ones this CLI calls (a posting URL
  is parsed, never fetched). The CLI sends an honest User-Agent (`lever-cli/1.0`),
  retries 429/5xx with backoff, and pauses 1 s between paged requests, matching
  the `Crawl-delay: 1` above. Keep volume reasonable.
- Description text is built from the posting's three text fields (`description`,
  `lists[].content`, `additional`), falling back to `descriptionPlain`/`additionalPlain`
  only when an HTML field is empty, with comments, `<script>`/`<style>`/`<template>`
  blocks, elements marked `hidden` or hidden by an inline `display:none`,
  `visibility:hidden` or `mso-hide:all` style, and invisible Unicode removed. CSS-only
  hiding (off-screen positioning, zero font size, stylesheet classes) needs a renderer
  and is **not** caught, so the text is still untrusted third-party content: in AI Job
  Search, run it through that repo's `tools/posting_guard.py` before it reaches an
  evaluation (`/apply`'s posting fetcher does this).
- Read-only: this skill searches and reads postings; it never fills in or submits an
  application. Lever's API documentation states that published postings are publicly
  viewable and may be scraped by third parties.
