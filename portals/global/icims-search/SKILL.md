---
name: icims-search
version: 1.0.0
description: >
  Use this skill to search an employer's job portal hosted on iCIMS
  (`<portal>.icims.com`, commonly `careers-<company>.icims.com`), or to fetch the
  full text, posted date and location of an iCIMS posting from its URL. Works for
  any country; portals are per employer. Trigger phrases: iCIMS job,
  icims.com link, careers-<company>.icims.com, "what jobs does <company> have
  open" when its careers site runs on iCIMS, search <company>'s iCIMS careers
  page, look up this iCIMS posting, fetch this job posting, icims jobs.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/icims-search/cli/src/cli.ts *)
---

# iCIMS Search Skill

Read employer job portals hosted on **iCIMS**, the applicant tracking system
behind the careers sites of thousands of large employers. Every employer gets
its own portal subdomain (`careers-<company>.icims.com`, `jobs-<company>.icims.com`,
`uscareers-<company>.icims.com`, ...), which is all a call needs. No
authentication, no API key, and **zero runtime dependencies**: it runs with just
`bun`. iCIMS's own API (`api.icims.com`) needs a customer ID plus credentials, so
this skill reads the public portal pages instead.

Unlike a job aggregator, iCIMS has **no cross-company search**: every call names
one portal. Use this skill to:

- Pull the full text, posted date and location of an iCIMS posting URL. `/apply`
  gets it this way, since WebFetch only summarizes these pages.
- List a target employer's open roles, filtered by keyword, location and age.

## Commands

### Search one employer's portal

```bash
bun run .agents/skills/icims-search/cli/src/cli.ts search --portal <subdomain|url> [flags]
```

Query syntax: iCIMS's own keyword search; space-separated words are AND in any order, double quotes make an exact phrase in that word order (`--query '"registered nurse"'`), single quotes are ignored, `OR` and `-exclusion` are not supported.

- `--portal <subdomain>` / `-p` — **required.** The portal's host label, e.g.
  `careers-usu`, or a `https://<portal>.icims.com/jobs...` URL.
- `--query <text>` / `-q` — keywords, answered by iCIMS's search over titles,
  descriptions and locations.
- `--location <text>` / `-l` — substring match on the posting's location, e.g.
  `"UT"`, `"Inglewood"`, `"Remote"`. Client-side: iCIMS's location filter needs
  option IDs the CLI does not collect.
- `--remote <mode>` — `remote`, `hybrid` or `onsite`, client-side. iCIMS has no
  workplace filter: the value comes from a card's telework/remote field (or a
  `Remote` location), so portals that print neither match nothing.
- `--jobage <days>` — posted within N days. Client-side, and only cards that
  carry a posted date can be judged: a card with no date (many portals print
  none) is kept, and `/scrape`'s own date check then decides on it.
- `--page <n>` — 1-indexed results page, mapped to the portal's own paging.
  The portal sets the page size (20 and 50 both observed).
- `--limit <n>` / `-n` — cap results emitted from this page.
- `--format json|table|plain` — default `json`.

`--location`, `--remote` and `--jobage` filter the one page this call fetched.
Nothing walks the rest of the board, so "no remote jobs" means none on that page,
not on the whole portal.

### Fetch one posting

```bash
bun run .agents/skills/icims-search/cli/src/cli.ts detail <url | id --portal <p>> [--format json|plain]
```

Accepts a `https://<portal>.icims.com/jobs/<id>/<slug>/job` URL (the portal is
read from it; the slug is optional), or a numeric job ID together with
`--portal` — one or the other, never both. Returns the full description, posted
date, location, employment type and requisition ID.

## Usage examples

```bash
# Engineering roles on a portal, as a table
bun run .agents/skills/icims-search/cli/src/cli.ts search -p careers-usu -q "engineer" --format table

# Exact phrase, narrowed to one campus
bun run .agents/skills/icims-search/cli/src/cli.ts search -p careers-usu -q '"teaching assistant"' -l "Brigham" --format table

# Nursing roles posted in the last 14 days
bun run .agents/skills/icims-search/cli/src/cli.ts search -p careers-primehealthcare -q nurse --jobage 14 --format table

# Hybrid roles on a portal that prints a telework field
bun run .agents/skills/icims-search/cli/src/cli.ts search -p careers-usu --remote hybrid --format table

# Full text of a posting from its URL
bun run .agents/skills/icims-search/cli/src/cli.ts detail "https://careers-usu.icims.com/jobs/11021/biology-teaching-assistant/job" --format plain

# Same posting by ID
bun run .agents/skills/icims-search/cli/src/cli.ts detail 11021 -p careers-usu --format json
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use. Search adds `meta.matched` and `meta.totalPages` |
| `table` | Quickly scanning search results |
| `plain` | Reading one posting in full (`detail`) |

Validation and request errors go to **stderr** as `{ "error": "...", "code": "..." }`, with exit code `1`.
Running the CLI with no command, or a bare `--help`, prints the help text to stdout and exits
`1`; `search --help` and `detail --help` exit `0`.

## Notes

- **Per-employer portals only.** The host label *is* the identifier: open any of
  the employer's iCIMS job links and read it (`careers-usu`, `jobs-selectmedicalcorp`).
  A careers site on the employer's own domain still links postings on
  `*.icims.com`; use that link. Portals that front iCIMS through a custom domain
  only are not reachable from their public hostname alone.
- **Page size is the portal's choice** (20 or 50 on sampled portals), and
  `meta.totalPages` comes from the portal's own "Search Results Page 1 of N".
  `--limit` caps one page; there is no full-board fetch.
- **Dates:** search cards print a posted date only on some portals; when absent,
  `date` is `null` (never guessed) and `--jobage` keeps the card instead of
  dropping it, because there is no date to compare. `detail` reads the posting's
  schema.org `datePosted`, so it always has one when the portal publishes it. A
  card date printed as `M/D/YYYY` is read US-style, which is what every sampled
  portal used.
- **`company`** is the portal's host label: the JSON-LD employer name is the
  literal string `UNAVAILABLE` on many portals, so the label is the honest value.
- **`workplace`** is only what the portal declares: a card's "Telework Eligible"
  or "Remote" field (`Hybrid` → `hybrid`, `No` → `onsite`, `Yes` on a "Remote"
  field → `remote`), or a location that says Remote. `null` means the portal said
  nothing; `--remote` cannot match an undeclared posting.
- A posting link on a sibling iCIMS host is kept, because some portals link
  postings on another subdomain (`careersat-ohsu` → `externalcareers-ohsu`).
  Links on any non-iCIMS host are dropped.
- A closed posting or a wrong slug may answer `200` with the portal's error page,
  and a removed posting may answer `404`/`410`; `detail` reports `NOT_FOUND` for all
  three. A search page that carries no iCIMS markup at all (a WAF interstitial on a
  200) fails with `SEARCH_FAILED` instead of reading as an empty board.
- **`robots.txt`:** on sampled portals it allows `/jobs/search` and posting pages,
  and disallows referral, login, candidate and `/connect` paths. The CLI requests
  only the search page and the posting page — never apply, referral, login or
  candidate URLs — sends an honest User-Agent (`Mozilla/5.0 (compatible; icims-cli/1.0)`),
  and retries 429/5xx with exponential backoff. Keep volume low: one page per call,
  never a crawl.
- Description text is the posting's HTML with comments, `<script>`/`<style>`/`<template>`
  blocks, elements marked `hidden` or hidden by an inline `display:none`,
  `visibility:hidden` or `mso-hide:all` style, and invisible Unicode removed. CSS-only
  hiding (off-screen positioning, zero font size, stylesheet classes) needs a renderer
  and is **not** caught, so the text is still untrusted third-party content: in AI Job
  Search, run it through that repo's `tools/posting_guard.py` before it reaches an
  evaluation (`/apply`'s posting fetcher does this).
- Read-only: this skill searches and reads postings; it never fills in or submits an
  application.
