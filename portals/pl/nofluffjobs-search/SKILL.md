---
name: nofluffjobs-search
version: 1.0.0
description: >
  Use this skill to search live IT and software job listings on nofluffjobs.com,
  Poland's second-largest tech job board and the strongest source for B2B contract
  rates — every listing states its salary, and each posting spells out its required
  languages and their levels. Covers Polish cities and remote roles, with filters
  for city, category and seniority. Trigger phrases (English): find a job in
  Poland, Polish job board, No Fluff Jobs, nofluffjobs, IT jobs Poland, B2B rates
  Poland, remote developer jobs Poland, "are there any <tech role> jobs in
  Warsaw/Kraków/Wrocław", look up this No Fluff Jobs offer. Trigger phrases
  (Polish): oferty pracy IT, praca zdalna programista, praca B2B, stawka
  godzinowa, widełki płacowe, oferty pracy Warszawa, praca dla programisty
  PHP/Pythona, ogłoszenia o pracę.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/nofluffjobs-search/cli/src/cli.ts *)
---

# No Fluff Jobs Search Skill

Search live job listings from **[nofluffjobs.com](https://nofluffjobs.com)** — the
Polish IT board built around **mandatory salary disclosure**. No authentication,
no API key, and **zero runtime dependencies** — it runs with just `bun`.

Its structural advantage over every other portal here: each posting states its
**required languages and levels** ("Polish (Fluent)", "English (C1)") as explicit
requirement entries rather than burying them in prose, so a language requirement
is a parsed field instead of something to infer from a description.

## ⚠️ Personal use only

This reads No Fluff Jobs' public, robots-permitted listing pages. **Keep volume
low, and don't use it commercially or for bulk data collection.** Run it on your
own responsibility.

`robots.txt` disallows **`/api/`** and **`/posting/`**, so this CLI never calls
the portal's JSON API. It reads the server-rendered `/pl` (search) and
`/job/<slug>` (detail) pages, which carry no `Disallow` rule.

## When to use this skill

- Search Polish IT openings by keyword, city (or remote), category and seniority
- Compare **B2B hourly, daily and monthly rates** across offers without opening any of them
- Read one posting's requirements, responsibilities, language levels and deadline
- Check whether a role's required languages match your own before investing time

## Commands

### Search job listings

```bash
bun run .agents/skills/nofluffjobs-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords (title, skill, technology). Recommended.
- `--location <place>` / `-l <place>` — a city or `Remote`. Accepts Polish diacritics and the Polish synonyms `zdalnie` / `praca zdalna`.
- `--category <slug>` / `-c <slug>` — `backend`, `frontend`, `fullstack`, `devops`, `testing`, `data`, `mobile`, …
- `--seniority <level>` — `trainee` | `junior` | `mid` | `senior` | `expert`
- `--page <n>` — 1-indexed. **The portal accumulates**: page N returns offers 1..20N, de-duplicated (see Notes).
- `--all` — read the 10-page cumulative view (offers 1..200) in **one request**. Hard cap; conflicts with `--page`. When the portal holds more matches than that, `meta.truncated: true` and `PAGE_CAP_REACHED` on stderr. `/scrape` always passes it.
- `--dates` — fill each result's publication date. **Free**: read from the search page's embedded state. Only results it leaves undated fall back to one detail request each, at most 30 per search.
- `--jobage <days>` — posted within N calendar days (under `--jobage 1`, yesterday's postings count). Implies `--dates`. No `--limit` needed.
- `--limit <n>` / `-n <n>` — cap results.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/nofluffjobs-search/cli/src/cli.ts detail <slug|url> [--format json|plain]
```

`slug` is the `id` from a `search` result. A full `https://nofluffjobs.com/job/<slug>`
URL works too. Returns the posting's requirements (including **language levels**),
responsibilities, offer description, publication date, application deadline,
employment type and every salary band it advertises.

## Usage examples

```bash
# PHP/Symfony roles across Poland
bun run .agents/skills/nofluffjobs-search/cli/src/cli.ts search -q "PHP Symfony" --format table

# Senior remote Symfony roles
bun run .agents/skills/nofluffjobs-search/cli/src/cli.ts search -q "symfony" -l Remote --seniority senior --format table

# Senior remote backend roles with publication dates
bun run .agents/skills/nofluffjobs-search/cli/src/cli.ts search -c backend -l Remote --seniority senior --limit 10 --dates --format table

# Payments roles in Warsaw, second page of results
bun run .agents/skills/nofluffjobs-search/cli/src/cli.ts search -q "payments" -l "Warszawa" --page 2 --format table

# Remote PHP roles posted in the last 14 days
bun run .agents/skills/nofluffjobs-search/cli/src/cli.ts search -q "php" -l Remote --jobage 14 --all --format json

# Full details for a specific offer
bun run .agents/skills/nofluffjobs-search/cli/src/cli.ts detail mid-senior-symfony-developer-legacy-modernization-fluent-english-polcode-remote --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use; the only format carrying tags, every salary band, and the detail sections |
| `table` | Quick human-readable scanning (title, company, location, posted, salary) |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page" }, "results": [...] }`; each result
carries `id`, `title`, `company`, `location`, `date`, `url` (the portal-skill
contract) plus `salary`, `tags` and `extraLocations`. `detail` adds `salaryBands`,
`deadline`, `requirements`, `tasks`, `description`, `employmentType`, `street` and
`country`. Missing values are `null`, never omitted. All errors are written to
**stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **Dates come from the page, not the cards.** The listing cards carry no date, but the
  page's embedded Angular state (`<script id="serverApp-state">`) has each main-list
  posting's `posted` timestamp - the same day the detail page reports as
  `datePosted` - plus the query's true `totalCount`. `date` is filled from it on every
  search; `renewed` (an employer "bump") is ignored. `null` still means "not known",
  never "old". Search `meta` is `{ count, page, total, truncated }`.
- **Only real matches are returned.** The portal pads short result lists with a "Mogą Cię też zainteresować" block of non-matching offers; the CLI drops it, so a narrow query can return fewer than 20 results - that is the true match count, not a parsing failure.
- **Results are always newest-first.** Every search sends `sort=newest`, so `--limit` keeps the most recently posted or renewed offers rather than the most relevant. Not configurable.
- **Pagination accumulates.** `?page=N` returns pages 1..N in one response, and the
  portal repeats promoted offers across them, so results are de-duplicated by slug.
  `--page 2` therefore yields ~40 unique offers, not offers 21-40.
- **Salaries come in several shapes** and all are parsed: `900 – 1 100 PLN / day`,
  `80 – 130 PLN + VAT (B2B) per hour`, `18 000 PLN / mth`, and abbreviated foreign
  bands like `1.5M – 2.5M HUF / month`. `salary.type` is `b2b` or `permanent` when
  the posting states it. A posting advertising both a B2B and a permanent band
  exposes both in `salaryBands`.
- **Detail pages append a "similar offers" list** carrying other companies' salary
  widgets. Parsing is scoped to the posting's own region, so those never leak into
  the returned salary — worth re-checking first if salaries ever look wrong.
- **Language requirements are first-class.** `requirements` lists them explicitly,
  e.g. `- Polish (Fluent)` / `- English (C1)`, which is exactly what the Language
  Gate in `04-job-evaluation.md` needs.
- **Not every listing is in Poland.** Some foreign employers advertise here
  (HUF and USD bands show up); `location` reports the posting's own city.
- **Postings are bilingual** — Polish or English depending on the employer, both
  returned as decoded UTF-8.
- Parsing anchors are documented in `url-reference.md` — the file to update if No
  Fluff Jobs changes its markup.
