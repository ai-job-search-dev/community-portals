---
name: justjoin-search
version: 1.0.0
description: >
  Use this skill to search live IT and software job listings on justjoin.it, the
  largest Polish tech job board, or to look up one justjoin.it posting. Covers the
  whole Polish market (all voivodeships and cities, plus fully remote roles), with
  filters for workplace mode, seniority, contract type and disclosed salary — every
  result carries its B2B or permanent salary band, because justjoin requires
  employers to publish one. Trigger phrases (English): find a job in Poland, Polish
  job board, justjoin, IT jobs Poland, B2B contract Poland, remote developer jobs
  Poland, "are there any <tech role> jobs in Warsaw/Kraków/Wrocław", look up this
  justjoin offer. Trigger phrases (Polish): oferty pracy IT, praca zdalna
  programista, szukam pracy, praca B2B, stawka godzinowa, oferty pracy Warszawa,
  praca dla programisty PHP/Pythona, ogłoszenia o pracę.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/justjoin-search/cli/src/cli.ts *)
---

# justjoin.it Search Skill

Search live job listings from **[justjoin.it](https://justjoin.it)** — Poland's
largest IT job board and the main channel for the Polish **B2B contract** market.
No authentication, no API key, and **zero runtime dependencies** — it runs with
just `bun`.

Unlike the HTML-card portals, justjoin server-renders its React data payload into
every search page, so one request returns fully structured offers: title, company,
city, workplace mode, seniority, required skills, publication and expiry dates,
**and the salary band** (justjoin makes salary disclosure mandatory for its
listings). No per-result detail fetch is needed to rank a search.

## ⚠️ Personal use only

This reads justjoin.it's public, robots-permitted listing pages. **Keep volume
low, and don't use it commercially or for bulk data collection.** Run it on your
own responsibility.

Two paths are deliberately *not* touched, because the site's `robots.txt`
disallows them:

- **`api.justjoin.it`** — the portal's JSON API host, whose `robots.txt` is
  `Disallow: /` for generic agents. This CLI never calls it, which is also why
  `--page` beyond 1 is unsupported (see Notes).
- **`justjoin.it/api/`** and the comma-filtered **`/oferty-pracy/*,*`** paths.

The pages this skill does read — `/job-offers/…` and `/job-offer/…` — carry no
`Disallow` rule.

## When to use this skill

- Search Polish IT job openings by keyword, city, category, seniority or contract type
- Find fully remote roles workable from Poland, with the B2B or permanent rate visible up front
- Filter to offers that disclose a salary band, or to a posting-age window
- Read one posting's full description, required skills and application deadline

## Commands

### Search job listings

```bash
bun run .agents/skills/justjoin-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, technology). Recommended.
- `--location <city>` / `-l <city>` — Polish city, e.g. `"Warszawa"`, `"Kraków"`, `"Gdańsk"`. Accepts Polish diacritics and normalizes them to the portal's slug. Defaults to the whole country.
- `--category <slug>` / `-c <slug>` — portal category: `php`, `python`, `javascript`, `java`, `net`, `devops`, `testing`, `data`, `architecture`, `mobile`, …
- `--workplace <mode>` — `remote` | `hybrid` | `office`
- `--experience <level>` — `junior` | `mid` | `senior` | `c-level`
- `--employment-type <type>` — `b2b` | `permanent` | `mandate` | `internship`
- `--with-salary` — only offers that disclose a band
- `--jobage <days>` — posted within N calendar days (under `--jobage 1`, yesterday's offers count). Applied **client-side** (see Notes).
- `--page <n>` — only `1` is supported; any other value is an error, never a silent no-op (see Notes). There is **no `--all`**: further pages come only from justjoin's private API, which robots.txt puts off limits, so one batch (~50–100 offers, newest first by original publication) is all a call can read. Keep queries narrow so the window fits in it.
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/justjoin-search/cli/src/cli.ts detail <slug|url> [--format json|plain]
```

`slug` is the `id` from a `search` result (e.g. `bitbag-mid-symfony-developer-opole-php-894bb716`).
A full `https://justjoin.it/job-offer/<slug>` URL works too. Returns the offer's
full description (paragraphs and bullet lists preserved), required skills,
seniority, salary band, application deadline, and whether the offer is still open.

Search results already carry everything except the description, so reach for
`detail` when you need the posting's text — not to re-read fields the search
already returned.

## Usage examples

```bash
# PHP/Symfony roles across Poland, newest first
bun run .agents/skills/justjoin-search/cli/src/cli.ts search -q "PHP Symfony" --format table

# Senior fully-remote architect roles
bun run .agents/skills/justjoin-search/cli/src/cli.ts search -q "software architect" --workplace remote --experience senior --format table

# B2B contracts in the PHP category with a disclosed rate, last 14 days
bun run .agents/skills/justjoin-search/cli/src/cli.ts search -c php --employment-type b2b --with-salary --jobage 14 --format table

# Payments roles in Warsaw, remote only
bun run .agents/skills/justjoin-search/cli/src/cli.ts search -q "payments" -l "Warszawa" --workplace remote --limit 10

# Python roles posted in the last week, as JSON
bun run .agents/skills/justjoin-search/cli/src/cli.ts search -q "python" --workplace remote --jobage 7 --format json

# Full details for a specific offer
bun run .agents/skills/justjoin-search/cli/src/cli.ts detail bitbag-mid-symfony-developer-opole-php-894bb716 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use; the only format carrying skills, deadline and sibling cities |
| `table` | Quick human-readable scanning (title, company, city, mode, date, salary) |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page" }, "results": [...] }`; each result
carries `id`, `title`, `company`, `location`, `date`, `url` (the portal-skill
contract) plus `workplaceType`, `experienceLevel`, `employmentType`, `salary`,
`deadline`, `skills` and `otherLocations`. Missing values are `null`, never
omitted. All errors are written to **stderr** as `{ "error": "...", "code": "..." }`
and the process exits with code `1`.

## Notes

- **Salary is the headline feature.** justjoin requires a published band, so
  `salary` is populated on most offers: `{ type, from, to, currency, unit, gross }`,
  where `unit` is `hour` or `month` and `type` is `b2b` / `permanent`. Converted
  currencies are discarded — the band returned is the one the employer published.
- **No posting-age parameter exists on the portal.** `--jobage` filters
  client-side on each offer's publication date. Offers with no date are kept
  rather than silently dropped.
- **Pagination is not supported.** justjoin server-renders one batch of offers
  (roughly 50–100, depending on the query) and loads further pages from its
  private API, which `robots.txt` puts off limits. `--page 2` therefore exits `1`
  with `PAGE_UNSUPPORTED` instead of quietly re-returning page 1 — narrow the
  search with `--category`, `--experience`, `--workplace` or `-q` instead.
- **Not every listing is in Poland.** A minority of offers are foreign (German,
  Dutch, US) companies advertising to Polish candidates; `location` reports the
  posting's own city, so downstream location filters still apply.
- **Multi-city offers.** One job advertised in several cities appears once per
  city, each with its own slug. `otherLocations` names the siblings, so duplicates
  are recognizable rather than looking like distinct roles.
- **Postings are bilingual.** Descriptions are in Polish or English depending on
  the employer; both come back as decoded UTF-8 text.
- **Deadlines are real.** `deadline` comes from the offer's own `expiredAt`, and
  `detail` reports `isActive: false` once a posting has closed.
- Rendering details and parsing anchors are documented in `url-reference.md` —
  the file to update if justjoin changes its markup.
