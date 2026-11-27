---
name: usajobs-search
version: 1.0.0
description: >
  Use this skill to search for US federal government job openings across all
  agencies (FBI, NASA, DoD, State Department, VA, USPS, etc.), filter by
  location, keyword, posting age, and remote work. Covers all civilian federal
  positions across all 50 states, territories, and remote roles. Requires a free
  USAJOBS developer API key — register at developer.usajobs.gov with your email.
  Trigger phrases: federal job, government job, agency hiring, USA jobs,
  civil service, federal position, work for the government.
context: fork
enabled: false  # set to true after adding USAJOBS_API_KEY and USAJOBS_EMAIL to your environment
allowed-tools: Bash(bun run .agents/skills/usajobs-search/cli/src/cli.ts *)
---

# USAJobs Search Skill

Search live federal job listings from [USAJobs.gov](https://www.usajobs.gov) — the
official job board for US federal government civilian positions. Covers **all executive
branch agencies** and many legislative/judicial branch roles.

> This portal uses the [USAJOBS Developer API](https://developer.usajobs.gov), which is
> free but requires registration. Data is official government data with no scraping
> restrictions.

## Setup (one-time)

1. Request a key at **[developer.usajobs.gov/apirequest](https://developer.usajobs.gov/apirequest/)** — provide your name and email address. USAJOBS emails you an API key.
2. Set both values as environment variables. USAJOBS requires the key as the
   `Authorization-Key` header and your registration email as the `User-Agent` header
   ([authentication guide](https://developer.usajobs.gov/guides/authentication)):
   ```bash
   export USAJOBS_API_KEY="the-key-from-the-usajobs-email"
   export USAJOBS_EMAIL="the-email-you-registered-with@example.com"
   ```
3. Set `enabled: true` in this SKILL.md (or use `/setup` if your skill has that flow).

## When to use this skill

- Search for federal job openings in a location or remotely
- Filter by posting age, remote work, or keyword (title, skill, agency name)
- Get the job summary and application link for a specific posting

## Commands

### Search job listings

```bash
bun run .agents/skills/usajobs-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--keyword <text>` / `-q <text>` — keywords (title, skill, agency). Optional.
- `--location <text>` / `-l <text>` — city, state, or region. Optional for nationwide search.
- `--days <n>` — posted within N days (1, 7, 14, 30). Omit for all.
- `--remote` — filter to remote/telework-eligible positions only.
- `--per-page <n>` / `-n <n>` — results per page (1–500, default 25).
- `--page <n>` — page number (1-indexed).
- `--limit <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/usajobs-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the position ID (e.g. `USGS-DEF-CA-26-00001`) or numeric job number from
search results, or a full `https://www.usajobs.gov/job/<number>/` URL.

## Usage examples

```bash
# Software engineer roles in California
bun run .agents/skills/usajobs-search/cli/src/cli.ts search -q "software engineer" -l "California" --format table

# Remote cybersecurity roles posted this week
bun run .agents/skills/usajobs-search/cli/src/cli.ts search -q "cybersecurity" --remote --days 7 --format table

# All federal jobs in Texas, most recent first
bun run .agents/skills/usajobs-search/cli/src/cli.ts search -l "Texas" --days 30 --format table

# Nationwide search, no filters
bun run .agents/skills/usajobs-search/cli/src/cli.ts search -q "data scientist" --format json

# Full detail for a specific job
bun run .agents/skills/usajobs-search/cli/src/cli.ts detail USGS-DEF-CA-26-00001 --format plain
bun run .agents/skills/usajobs-search/cli/src/cli.ts detail https://www.usajobs.gov/job/789456123/ --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Notes

- Data is from the official USAJOBS REST API — structured JSON, no HTML scraping.
- API key is free and issued instantly at developer.usajobs.gov.
- Rate limits are generous; exponential backoff handles 429s automatically.
- Job IDs take two forms: a human-readable position ID (`AGENCY-LOC-YY-NNNNN`) and
  a numeric `MatchedObjectId` that appears in usajobs.gov URLs.
