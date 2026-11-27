---
name: google-jobs-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search Google Jobs — the job
  postings panel in Google search results that gathers listings from LinkedIn,
  Indeed, Glassdoor, company career sites and recruiters into one list — or to
  look up one posting from such a search. Invoke for open positions, vacancies
  and hiring in the US, UK, India or Germany, across any sector (software, data,
  design, marketing, finance, legal, healthcare, operations, etc.). Trigger
  phrases: Google Jobs, job search, jobs from LinkedIn/Indeed/Glassdoor/company
  sites in one search, recruiter and agency postings, search Google for jobs,
  vacancies near me, "are there any X jobs in <city>", look up this job posting.
context: fork
enabled: false  # metered (Apify) and Google's terms restrict automated access - ships opt-in; read "Setup" and "Terms" below before setting true
allowed-tools: Bash(bun run .agents/skills/google-jobs-search/cli/src/cli.ts *)
---

# Google Jobs Search Skill

Search postings from Google Jobs — the jobs panel Google shows above ordinary
search results, which aggregates listings from LinkedIn, Indeed, Glassdoor,
company career pages, recruiters and agency boards into one list.

This skill does **not** request google.com. It calls the Apify Actor
[`krammer/google-jobs-scraper`](https://apify.com/krammer/google-jobs-scraper)
with the user's own Apify API token and reads the results from the run's
dataset. **Zero runtime dependencies** — it runs with just `bun`.

## ⚠️ Metered: read before you switch this on

Every `search` starts a paid Actor run on the user's Apify account. The Actor is
billed per Google results page. Its current rates are on the Actor page above and
are deliberately not repeated here. Apify's free plan includes a monthly amount of
usage. `detail` reads an already-finished run's dataset and incurs no Actor fee.

## ⚠️ Terms

Google's [Terms of Service](https://policies.google.com/terms) (effective July 30,
2026, section "Don't abuse our services"; checked 2026-11-26) prohibit:

> using automated means to access content from any of our services in violation of
> the machine-readable instructions on our web pages (for example, robots.txt files
> that disallow crawling, training, or other activities)

Google's `robots.txt` does not allow `/search`. This CLI itself never requests
Google: it calls only `api.apify.com`, and the Actor is what retrieves the
postings. Whether that use is acceptable for you is your decision, not this
skill's — if you enable it, keep volume low and use it for personal use only.

**Disclosure:** this portal's owner also wrote the Apify Actor it calls.

## Setup

1. Create an [Apify](https://apify.com) account.
2. Copy an API token from Apify Console → **Settings → API & Integrations**.
3. Export it in the environment the skill runs in:

   ```bash
   export APIFY_API_TOKEN=...
   ```

The token is read only from `APIFY_API_TOKEN`. It is never accepted as a flag
(flags leak into shell history and the process list) and never written to disk by
this skill. Without it, the CLI exits `1` with code `MISSING_TOKEN` and sends no
request.

## When to use this skill

- Search postings across many boards at once (Google Jobs aggregates them)
- Filter by recency (`--jobage 1` for the last day) or remote-only
- Read one posting's full description and apply links

## Commands

### Search job listings

```bash
bun run .agents/skills/google-jobs-search/cli/src/cli.ts search --query "<text>" [flags]
```

Query syntax: the query is sent to Google Jobs as typed; phrase quoting and OR are not verified.

Key flags:

- `--query <text>` / `-q <text>` — **required.** Keywords: job title, skill, or role.
- `--location <text>` / `-l <text>` — free-text location, e.g. `"Chicago, IL"`. Omit to search the whole country.
- `--country <code>` — `us` (default) | `gb` | `in` | `de`.
- `--jobage <days>` — posted within N days. Mapped to the Actor's `datePosted`: `1` → last 24 hours, `2`–`3` → last 3 days, `4`–`7` → last 7 days, `8`–`30` → last 30 days, more than `30` or unset → any time. A non-positive or non-integer value exits `1`.
- `--remote` — boolean; only remote postings (the Actor's `remoteOnly`).
- `--page <n>` — 1-indexed page. Default `1`.
- `--limit <n>` / `-n <n>` — results per page. Default `10`, maximum `200`.
- `--format json|table|plain` — default `json`.

**Page cost:** the Actor has no offset parameter, so page N is reached by running
it again for `page × limit` results and dropping the earlier ones. Each `--page`
therefore starts **one new, separately billed run** that returns more results
than the page shows. `page × limit` above `200` exits `1` with `PAGE_TOO_DEEP`
before any request.

### Read one posting

```bash
bun run .agents/skills/google-jobs-search/cli/src/cli.ts detail <dataset_id>:<offset> [--format json|plain]
```

The `id` from a `search` result, in the form `<dataset_id>:<offset>` (for
example `jPV8SE3dHqcuO2M3C:0`). `detail` reads the record straight from that
already-finished run's dataset: it starts no run and incurs no Actor fee. Apify
keeps datasets for a limited time; once the dataset expires, the same id answers
`NOT_FOUND`.

## Usage examples

```bash
# Software engineer roles in San Francisco, posted in the last 7 days
bun run .agents/skills/google-jobs-search/cli/src/cli.ts search -q "software engineer" -l "San Francisco, CA" --jobage 7 --format table

# Registered nurse roles in Boston, posted in the last 24 hours
bun run .agents/skills/google-jobs-search/cli/src/cli.ts search -q "registered nurse" -l "Boston, MA" --jobage 1 --format table

# Remote data analyst roles anywhere in the US
bun run .agents/skills/google-jobs-search/cli/src/cli.ts search -q "data analyst" --remote --limit 20 --format table

# Marketing manager roles in London, UK
bun run .agents/skills/google-jobs-search/cli/src/cli.ts search -q "marketing manager" -l "London" --country gb --format table

# Second page of 10
bun run .agents/skills/google-jobs-search/cli/src/cli.ts search -q "product manager" -l "Austin, TX" --page 2 --format table

# Full detail for one posting
bun run .agents/skills/google-jobs-search/cli/src/cli.ts detail jPV8SE3dHqcuO2M3C:0 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing ids to `detail`. Includes `meta.run_id` and `meta.dataset_id`. |
| `table` | Quick human-readable scanning. |
| `plain` | Reading a single posting's full detail (`detail` command). |

Every result carries `id`, `title`, `company`, `location`, `date`, `url`,
`description`, plus `salary`, `salaryMin`, `salaryMax`, `salaryCurrency`,
`salaryPeriod`, `workMode`, `jobTypes` and `apply_options`. A value Google did not
return is `null`, never omitted.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and
the process exits with code `1`. Error codes: `MISSING_TOKEN`, `AUTH`, `QUOTA`,
`RUN_TIMEOUT`, `RUN_FAILED`, `PAGE_TOO_DEEP`, `BAD_ID`, `NOT_FOUND`, `BAD_ARG`,
`UNKNOWN_FLAG`, `HTTP_ERROR`.

## Notes

- `id` is `<dataset_id>:<offset>`. It only works while Apify keeps that run's dataset; a new `search` produces a new dataset and new ids.
- `--page N` costs a fresh Actor run for `N × limit` results (see "Page cost" above).
- `--country` accepts only `us`, `gb`, `in` and `de` — the countries the Actor supports.
- `description` is plain text. HTML from the source board is not returned.
- Google's posted time can reflect when it indexed the posting, not when the employer first published it. Treat `date` as a lower bound on age.
- The Actor may return fewer results than `limit` (Google's own panel is finite); that is not an error.
- `GOOGLE_JOBS_SEARCH_API_URL` overrides the API base URL. It exists so the tests can point the CLI at a loopback server; leave it unset in normal use.
