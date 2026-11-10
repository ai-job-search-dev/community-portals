---
name: bulldogjob-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for IT jobs on Bulldogjob
  (bulldogjob.pl), the Polish IT job board, or look up a Bulldogjob offer. Covers
  software, backend, frontend, DevOps, data, QA and architect roles in Poland, including
  fully remote offers; postings are in Polish or English. Trigger phrases: bulldogjob,
  bulldog job, bulldogjob.pl, Polish IT jobs, oferty pracy IT, praca IT, praca zdalna IT,
  ogłoszenia dla programistów, szukam pracy programisty, oferty pracy PHP, look up this
  Bulldogjob offer.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/bulldogjob-search/cli/src/cli.ts *)
---

# Bulldogjob Search Skill

Search live IT job offers on [bulldogjob.pl](https://bulldogjob.pl) (Poland). No
authentication, no API key, **zero runtime dependencies** - just `bun`. Postings are in
Polish or English; salary ranges are mostly shown.

## ⚠️ Personal use only

This reads Bulldogjob's public pages. `robots.txt` permits `/companies/jobs`, but the
site's terms page could not be read during setup (HTTP 403), so check its Regulamin
yourself. **Keep volume low, don't use it commercially or for bulk data collection**, and
run it on your own responsibility.

## No free-text search - how `--query` works

Bulldogjob's list pages filter only by **skill, role, level and city**; free-text
parameters (`q`, `search`, `term`) are ignored by the server. So:

- the **first word** of `--query` is the server-side skill filter (`PHP`, `Symfony`,
  `Kubernetes`, `Java` - case-insensitive; `architect` also works as it is a role-like tag);
- the **remaining words** must all appear in the offer title or technology tags
  (client-side, diacritic-insensitive). They force a sweep of all pages (max 10 pages =
  500 offers), so they cannot be combined with `--page`;
- `--skill <name>` sets the skill explicitly; then every `--query` word is a title/tag word.

An unknown skill returns zero results (verified), never the whole portal.

## Commands

```bash
bun run .agents/skills/bulldogjob-search/cli/src/cli.ts search [flags]
bun run .agents/skills/bulldogjob-search/cli/src/cli.ts detail <id|slug|url> [--format json|plain]
```

### Search flags

| Flag | Meaning |
|------|---------|
| `--query`, `-q` | Skill + optional title words (see above) |
| `--skill` | Explicit skill filter |
| `--role` | Role filter, e.g. `backend`, `frontend`, `fullstack`, `devops` |
| `--level` | `junior` \| `medium` \| `senior` \| `lead` |
| `--city`, `-l` | `Remote`, Warszawa, Kraków, Wrocław, Gdańsk, Łódź, Poznań, Katowice, Białystok, Rzeszów, Lublin (case/diacritics-insensitive). Anything else exits 1 |
| `--jobage <days>` | Posted within N calendar days (`--jobage 1` includes today and yesterday). **Client-side**: list pages carry no date, so this reads each result's detail page (one request per result, 300 ms apart). Implies `--dates`. An offer whose date lookup failed is kept with `date: null` (and reported as `DATE_LOOKUP_FAILED` on stderr), so not every result is guaranteed to be within N days |
| `--dates` | Fill `date`/`postedAt` for every result (same extra requests) |
| `--page <n>` | 1-indexed, 50 offers per page |
| `--all` | Sweep pages until one adds nothing (cap 10 pages = 500 offers; warns `PAGE_CAP_REACHED` only when the portal reports offers beyond the cap) |
| `--limit`, `-n` | Cap results emitted |
| `--format` | `json` (default) \| `table` \| `plain` |

At least one of `--query/--skill/--role/--level/--city` is required (`NO_FILTER`).
Unknown flags exit 1 (`UNKNOWN_FLAG`). Results are sorted newest first: by date when
known, else by offer id (ids grow with creation time).

### Examples

```bash
# PHP offers in Poland
bun run .agents/skills/bulldogjob-search/cli/src/cli.ts search -q "PHP" --format table
# PHP architect offers, fully remote
bun run .agents/skills/bulldogjob-search/cli/src/cli.ts search -q "PHP architect" -l Remote --format table
# Senior Symfony offers from the last 14 days
bun run .agents/skills/bulldogjob-search/cli/src/cli.ts search --skill Symfony --level senior --jobage 14 --format json
# Backend roles in Warsaw, newest first
bun run .agents/skills/bulldogjob-search/cli/src/cli.ts search --role backend -l Warszawa --all --limit 20 --format table
# Full offer text
bun run .agents/skills/bulldogjob-search/cli/src/cli.ts detail 260906 --format plain
```

## Output

JSON search output: `{ "meta": { "count", "total", "page", "pages", "truncated" }, "results": [...] }`.
Each result: `id` (slug, e.g. `260906-php-developer-gdansk-teamquest`), `title`, `company`,
`location`, `date`, `postedAt`, `url`, plus `remote`, `level`, `employmentType`,
`contracts` (`B2B`/`employment`/`other`), `salary` (null when hidden), `tags`. Missing
values are `null`. `detail` adds `description`, `deadline`, `workModes`, `workFrom`,
`locations`, `minExperienceYears`, `isActive`. Errors go to stderr as
`{ "error", "code" }` with exit 1.

## Notes

- **`date` is null on search results** unless `--dates`/`--jobage` is used; never infer it.
- `city=Remote` returns offers that allow remote work; check `workModes` in `detail`
  (`full-remote`, `hybrid`, `on-site`) and `workFrom` (countries the work may be done from)
  for the real arrangement.
- Detail accepts a bare number (`260906`; the portal redirects to the canonical slug), a
  slug, or a bulldogjob.pl URL. URLs on other hosts are rejected.
- Salary is the portal's own formatted text in the stated currency; the CLI does not read the `timeframe` field, so the pay period (month, hour) is whatever the text says. `contracts` tells which contract it applies to.
- Data comes from the page's embedded Next.js JSON; if the site changes, the CLI fails with
  `PARSE_FAILED` instead of returning garbage. See `url-reference.md`.
