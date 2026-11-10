---
name: solidjobs-search
version: 1.0.0
description: >
  Use this skill to search live job offers on SOLID.Jobs (solid.jobs), the Polish
  job board with 100% published salary ranges, or to look up one SOLID.Jobs offer.
  Covers Poland (all cities plus fully remote roles) across IT and seven other
  divisions, with filters for city, seniority, category/technology and minimum
  salary — SOLID.Jobs requires a published salary range, so most results carry a B2B
  or employment-contract band. Search uses the portal's official public API (no
  key); detail reads the offer page's JSON-LD. Trigger phrases
  (English): find a job in Poland, Polish job board, SOLID.Jobs, solid jobs, IT jobs
  Poland with salary, B2B contract Poland, remote developer jobs Poland, "are there
  any <tech role> jobs in Warsaw/Gdańsk/Szczecin", look up this solid.jobs offer.
  Trigger phrases (Polish): oferty pracy IT, praca zdalna programista, szukam pracy,
  jawne widełki, praca B2B, oferty pracy Warszawa, praca dla programisty PHP,
  ogłoszenia o pracę, SOLID.Jobs.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/solidjobs-search/cli/src/cli.ts *)
---

# SOLID.Jobs Search Skill

Search live job offers from **[SOLID.Jobs](https://solid.jobs)**, a Polish job
board that requires every offer to publish its salary range. The skill calls the
portal's **official public REST API** (`/public-api/offers/{division}`) for
`search`, which SOLID.Jobs publishes for aggregators and AI agents. The API has no
single-offer endpoint, so `detail` instead reads the schema.org JSON-LD that an
offer page publishes for crawlers. No account, no API key, and **zero runtime
dependencies**: it runs with just `bun`.

## Access and usage

- The API is free and keyless. Each request carries a self-chosen `campaign`
  identifier (`ai-job-search-cli`), which the portal uses only for traffic
  analytics. See https://solid.jobs/api-ofert-pracy.
- `robots.txt` allows everything except `/management/` and `/admin/`, and it
  explicitly allows AI crawlers. The offer pages read by `detail` are allowed.
- Documented limit: **300 requests/minute per IP**, with responses cached for an
  hour. A normal `/scrape` run makes a handful of calls. Keep it that way.

## When to use this skill

- Search Polish job offers by keyword, city, seniority, category or minimum salary
- See the B2B or employment-contract rate up front, without opening each offer
- Find fully remote roles workable from Poland
- Read one offer's full description, skills, required experience and expiry date

## Commands

### Search job offers

```bash
bun run .agents/skills/solidjobs-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>`: full-text search (title, technology, skill). Recommended.
- `--location <cities>` / `-l <cities>`: comma-separated Polish cities, e.g. `"Warszawa,Kraków"`. Defaults to the whole country.
- `--division <name>` / `-d <name>`: `IT` (default), `Engineering`, `Marketing`, `Sales`, `HR`, `Logistics`, `Finances`, `Other`.
- `--experience <levels>`: comma-separated `Intern`, `Junior`, `Regular`, `Senior` (case-insensitive).
- `--category <name>`: main category, e.g. `Developer`, `Architect`, `DevOps`, `Analyst`, `ItManager`.
- `--subcategory <name>`: e.g. `PHP`, `Python`, `Java`, `DotNet`, `JavaScript`, `Golang`.
- `--min-salary <n>`: lower salary bound ≥ n (PLN).
- `--remote <mode>`: `remote` | `hybrid` | `onsite`. Applied **client-side** (see Notes).
- `--jobage <days>`: published within N days. Applied **client-side** (see Notes).
- `--page <n>`: 1-indexed page of 50 offers, newest first.
- `--all`: sweep pages until a short or last page or, with `--jobage`, a page that already reaches offers older than the window (results are newest first). **Hard cap: 10 pages (500 offers)**, 0.5 s apart. Conflicts with `--page`. A capped sweep sets `meta.truncated: true` and warns `PAGE_CAP_REACHED`. `/scrape` always passes it.
- `--limit <n>` / `-n <n>`: cap results emitted (client-side).
- `--format json|table|plain`: default `json`.

Unknown flags and invalid enum values exit `1` with a JSON error. They are never
silently dropped.

### Fetch full offer detail

```bash
bun run .agents/skills/solidjobs-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the short code from a `search` result (e.g. `mo6txlr4`). A short link
(`https://solid.jobs/o/<code>`) or a full offer URL
(`https://solid.jobs/offer/<number>/<slug>`) works too. Returns the full
description (paragraphs and bullet lists preserved), salary, contract type,
required experience in months, skills, posting date, deadline, and `isActive`.

## Usage examples

```bash
# Senior PHP roles across Poland, newest first
bun run .agents/skills/solidjobs-search/cli/src/cli.ts search -q "php" --experience Senior --format table

# Fully remote Symfony roles posted in the last 14 days
bun run .agents/skills/solidjobs-search/cli/src/cli.ts search -q "symfony" --remote remote --jobage 14 --format table

# PHP developer offers with a lower salary bound of at least 20k PLN
bun run .agents/skills/solidjobs-search/cli/src/cli.ts search --subcategory PHP --min-salary 20000 --format table

# Architect roles in Gdańsk or Szczecin
bun run .agents/skills/solidjobs-search/cli/src/cli.ts search --category Architect -l "Gdańsk,Szczecin" --format table

# Senior backend roles from the last 14 days, as JSON for /scrape
bun run .agents/skills/solidjobs-search/cli/src/cli.ts search -q "backend" --experience Senior --jobage 14 --all --format json

# Full details for one offer
bun run .agents/skills/solidjobs-search/cli/src/cli.ts detail mo6txlr4 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default. Programmatic use, and the only format carrying skills, languages, deadline and the secondary salary |
| `table` | Quick human scanning (id, title, company, city, mode, date, salary) |
| `plain` | Reading a single offer's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "pages", "totalCount", "totalPages", "truncated" }, "results": [...] }`.
`pages` is how many pages were read and `truncated` is `true` when `--all` stopped at its page cap with more offers available.
Each result carries the portal-skill contract fields `id`, `title`, `company`,
`location`, `date` and `url`. It also carries `workplaceType` (`remote`/`hybrid`/`onsite`),
`experienceLevel`, `category`, `subCategory`, `salary`, `secondarySalary`,
`deadline`, `skills` and `languages`. Missing scalar values are `null`, never omitted;
missing `skills` and `languages` are empty arrays (`[]`).
`totalCount` is the server-side match count before the client-side filters run.
All errors go to **stderr** as `{ "error": "...", "code": "..." }`, with exit code `1`.

## Notes

- **Salary on most offers.** `salary` is `null` when an offer lists no band, otherwise
  `{ from, to, currency, period, employmentType }`: `period` is `Month` or `Hour`,
  and `employmentType` is `B2B`, `Permanent` and so on. An offer that lists both
  contract types puts the second one in `secondarySalary`. In `detail`,
  `employmentType` comes from schema.org, for example `CONTRACTOR`.
- **No server-side remote or date filter.** The API filters by text, city,
  category, seniority and minimum salary only. `--remote` and `--jobage` filter
  the fetched pages (sorted newest first), so a page can return fewer than
  50 results. `--jobage` compares calendar days: an offer dated on the cutoff's
  own day is kept. Offers with no date are kept, never silently dropped.
- **`date` is the offer's `validFrom`** (when it went live) and **`deadline` is
  `validTo`** (its real expiry). Offers run about 30 days, and `detail` reports
  `isActive: false` once an offer has expired.
- **City spelling comes from the employer.** Typos such as `Warszaww` appear
  verbatim. `--location` filtering happens server-side.
- **Postings are mostly in Polish**, with some in English. Both pass this repo's
  language filter.
- **Small board, narrow full-text.** About 1,500 active IT offers. Niche terms
  often return zero (`płatności`: 0, `payments`: 1 on 2026-11-02). Prefer broad
  technology terms (`php`, `backend`) or `--subcategory`/`--category`.
- **Stable ids.** `id` is the offer's short code and `url` is its short link
  `https://solid.jobs/o/<code>`. The API appends the campaign to its own URLs,
  and the CLI strips it so stored URLs stay clean for dedup.
- Endpoints, parameters and response anchors are in `url-reference.md`. Update
  that file if the API changes.
