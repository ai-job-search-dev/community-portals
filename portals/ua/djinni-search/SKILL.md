---
name: djinni-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for IT and tech jobs in Ukraine or
  jobs open to candidates based in Ukraine, browse Djinni (djinni.co) vacancies, find
  remote developer roles on the Ukrainian market, or look up a specific Djinni job
  posting — even if they don't name djinni.co explicitly. Invoke for frontend, backend,
  full-stack, React, Node.js, JavaScript, QA, DevOps, data and other tech roles, with
  filters for remote work, region, city, category and salary. Trigger phrases include:
  djinni, джинні, вакансії djinni, пошук роботи, робота в IT, ІТ вакансії, віддалена
  робота, вакансії розробника, вакансії frontend, вакансії React, вакансії full stack,
  робота Київ, робота Львів, IT jobs Ukraine, Ukrainian tech jobs, remote jobs Ukraine,
  developer jobs Kyiv, React jobs Ukraine, full stack jobs Ukraine, djinni jobs, look up
  this djinni posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/djinni-search/cli/src/cli.ts *)
---

# Djinni Search Skill

Search live job listings on [Djinni](https://djinni.co/jobs/), a major Ukrainian IT job
board, and read full postings. No authentication, no API key, and **zero runtime
dependencies**: it runs with just `bun`.

## Be polite

Djinni's `robots.txt` allows the `/jobs/` pages this skill reads, and its terms restrict
harvesting *candidates'* personal data, which this skill never touches. Still, keep volume
low: a few searches per session and `detail` only for postings worth reading, never a crawl.
This is for personal job searching only: don't republish or resell what it returns.

## When to use this skill

- Find tech roles on the Ukrainian market, or remote roles open to candidates in Ukraine
- Filter by Djinni category, remote/part-time/office, candidate region, city, or salary
- Get the full description, work format and language requirements of one posting

## Commands

### Search job listings

```bash
bun run .agents/skills/djinni-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords. Djinni's basic search matches titles and tags.
  Quote multi-word values (`-q "React Native"`): a stray unquoted word is an error, not ignored.
- `--search-type <type>` — `basic` (default), `full-text` (whole description, broader and noisier), or `title`. Needs `--query`.
- `--category <name>` / `-c <name>` — a Djinni category such as `"React.js"`, `"JavaScript"`, `"Fullstack"`, `"Node.js"`, `"Python"`, `"QA Automation"`. Matched case-insensitively; an unknown name exits 1 with suggestions, because Djinni would silently ignore it and return the whole board.
- `--employment <mode>` — `remote`, `parttime`, or `office`.
- `--region <region>` — countries the posting accepts candidates from: `ukraine`, `eu`, `worldwide`, `other`.
- `--location <city>` / `-l <city>` — city slug for office roles: `kyiv`, `lviv`, `kharkiv`, `odesa`, `dnipro`, and the other regional centres.
- `--salary <usd>` — Djinni's monthly salary filter in USD. It also matches postings whose salary is private.
- `--public-salary` — only postings that show their salary.
- `--jobage <days>` — posted within N days. Djinni has no age parameter, so this filters the fetched page client-side (results are newest first).
- `--page <n>` — page number (1-indexed, 15 results per page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/djinni-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job id from `search` results (e.g. `855979`). A full
`https://djinni.co/jobs/<id>-<slug>/` URL or the `<id>-<slug>` segment also works; URLs on
any other host are rejected. Returns the description plus the sidebar facts: work format,
offices, experience, every language requirement, salary, category and the expiry date.

## Usage examples

```bash
# React roles, remote, open to candidates in Ukraine
bun run .agents/skills/djinni-search/cli/src/cli.ts search -q React --employment remote --region ukraine --format table

# Python roles, remote, $3000+/month
bun run .agents/skills/djinni-search/cli/src/cli.ts search -c Python --employment remote --salary 3000 --format table

# Anything mentioning "LLM" in its description, posted in the last 7 days
bun run .agents/skills/djinni-search/cli/src/cli.ts search -q "LLM" --search-type full-text --jobage 7 --format table

# JavaScript roles with an office in Kyiv
bun run .agents/skills/djinni-search/cli/src/cli.ts search -c JavaScript -l kyiv --format table

# Remote Node.js roles that publish their salary
bun run .agents/skills/djinni-search/cli/src/cli.ts search -c "Node.js" --employment remote --public-salary --format table

# Full details for one posting
bun run .agents/skills/djinni-search/cli/src/cli.ts detail 855979 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Each search result carries `id`, `title`, `company`, `location`, `date`, `url` (the
contract fields, `null` when missing), plus `remoteOnly`, `offices`, `employmentType`,
`experienceYears`, `english`, `salary`, `salaryTier` and `category`. `meta.total` is the
result count Djinni reports for the whole search.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **Labels are Ukrainian.** Djinni renders anonymous pages in Ukrainian: `location` reads like `Країни Європи та Україна` (European countries and Ukraine) or `Україна`, and `detail`'s `workplace` like `Тільки віддалено` (remote only) or `Офіс, Віддалена робота, Гібридний формат роботи` (office, remote, hybrid). Postings themselves are in English or Ukrainian.
- **`location` is where candidates may be, not where the office is.** Office cities come from the posting's structured data, in `offices`.
- **`--employment remote` is wider than remote-only.** It also returns office and hybrid roles that offer remote as one option. `remoteOnly: true` means Djinni marks the posting remote-only; for any other result, read `workplace` from `detail` before deciding.
- **Language requirements:** `english` is the English level (`B1`, `B2`, `C1`, or `Немає` for none). `detail`'s `languages` lists every requirement, including others such as `Українська Носій мови` (Ukrainian, native speaker).
- **Salary:** `salary` is a public figure as shown (`до $6000` = up to $6000). Most postings keep salary private and show only `salaryTier`, Djinni's relative level from `$` (below average) to `$$$$` (top).
- **Categories:** Djinni files many React roles under `JavaScript` or `Fullstack`, so `-c "React.js"` alone is narrow; `-q React` (basic search) is broader. The accepted category list is in `cli/src/helpers.ts` (`CATEGORIES`), taken from Djinni's RSS feed.
- Page size is fixed at 15 results. The CLI retries 429/5xx with exponential backoff.
- Live smoke test: `cd .agents/skills/djinni-search/cli && DJINNI_LIVE=1 bun run test`. Without `DJINNI_LIVE` the suite is fully offline.
