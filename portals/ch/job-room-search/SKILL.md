---
name: job-room-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs on job-room.ch, the
  official Swiss government (SECO) job platform / Public Employment Service — for
  jobs in Switzerland generally, or specifically in Romandie (Geneva, Vaud, Valais,
  Neuchâtel, Fribourg, Jura) or any other canton. Trigger phrases (English & French):
  job-room, jobs in Switzerland, Swiss job board, emploi Suisse, offres d'emploi
  Suisse, recherche d'emploi, ORP, RAV, service public de l'emploi, SECO jobs,
  ch.indeed-style Swiss listings, "postes vacants en Suisse romande".
context: fork
enabled: false  # Swiss portal - ships opt-in; set true here when your market is Switzerland
allowed-tools: Bash(bun run .agents/skills/job-room-search/cli/src/cli.ts *)
---

# job-room.ch Search Skill

Search live job listings from **job-room.ch** — the official Swiss federal job
platform operated by SECO (Staatssekretariat für Wirtschaft / Secrétariat d'État à
l'économie), the Public Employment Service behind ORP/RAV offices. Public,
unauthenticated JSON API, and **zero runtime dependencies** — it runs with just `bun`.

> This mirrors the repo's `linkedin-search` skill pattern, adapted to job-room.ch's
> JSON POST-search API instead of scraped HTML.

## Why this portal is worth running in a Swiss job search

job-room.ch is the SECO / public employment service platform. Under the **job registration
requirement** (Stellenmeldepflicht / obligation d'annonce), an employer filling a vacancy in a
covered occupation must report it here and may not advertise it anywhere else for five working
days; that window is exclusive to jobseekers registered with the RAV/ORP. The covered-occupation
list is revised annually, published in the fourth quarter and valid from 1 January to 31
December. The 2026 list added occupations such as cooks and cleaning staff, taking coverage from
6.5% of the workforce in 2025 to 10.8% in 2026 — figures and dates per SECO/arbeit.swiss,
[Job registration requirement from 2026](https://www.secoalv.admin.ch/secoalv/en/home/menue/unternehmen/stellenmeldepflicht/stellenmeldepflicht-ab-2026.html)
(checked 11 November 2026).

### This CLI does not see inside that window — measured, not assumed

An earlier version of this file claimed the exclusivity window as a head start available
through this skill. **That was wrong**, and the API says so plainly. Probed anonymously on
12 November 2026:

- 500 consecutive ads: every one `status: PUBLISHED_PUBLIC`, and **zero** with
  `reportingObligation: true`.
- A `cuisinier` search (cooks became a covered occupation in 2026): 15 of 100 ads carried
  `reportingObligation: true`, and **every one had `reportingObligationEndDate` already in the
  past** — 1 to 3 days before the probe date. The newest had closed the previous day.

So registration-obligation ads reach the unauthenticated API **after** their RAV-only window
closes, not during it. The five-day head start is real, but it belongs to a logged-in RAV/ORP
jobseeker on the website; an anonymous client, this CLI included, cannot act on it. Do not
tell a user otherwise.

What the CLI *can* do with it: `reportingObligation` and `reportingObligationEndDate` are
surfaced on every result, so a recently closed window is visible as a freshness signal — an
obligation ad whose window ended yesterday has only just become open to everyone.

Practical consequence: it is still worth running — it carries public-sector and RAV-channel
postings that commercial boards do not, and it is free and unauthenticated — but run it
*alongside* jobup.ch and LinkedIn rather than ahead of them in the expectation of exclusivity.
Search all relevant cantons in one call rather than just the home canton, e.g. all of Romandie
with `--canton GE,VD,VS,NE,FR,JU`.

### Three API gotchas worth knowing

1. **`detail` needs the full UUID.** `--format table` truncates the id to eight characters,
   and feeding that back returns
   `{"error":"Could not parse a job-room UUID from \"e75c4b4a\"","code":"BAD_ID"}`.
   Use `--format json` to get the full `id` before any `detail` call.
2. **The job-registration flag does exist** — an earlier version of this file said it did not.
   `reportingObligation` (boolean) and `reportingObligationEndDate` are on every ad and are
   surfaced by this CLI. What they do *not* give you is an in-window posting: see the measured
   section above. `externalUrl` remains a useful companion signal — when present, the posting is
   also syndicated publicly (commonly from jobup.ch), so the same role is discoverable elsewhere.
3. **Keyword relevance is loose, and multi-word queries degrade badly.** A query like
   `"sécurité information"` returns largely unrelated postings (the API appears to match
   terms loosely), while a single compound term like `"cybersécurité"` returns relevant ones.
   Related queries also return inconsistent sets from the same corpus, so a role can surface
   under one term and not under a near-synonym. Run **several short queries** rather than one
   precise long one, and filter client-side.

`languageIsoCode` on each result is **not** the posting's original language: it reports which
description variant the CLI selected, preferring `fr`, then `de`, `en`, `it`. A listing written
in German that also carries a French translation therefore reports `fr`. Use it to know which
text you are reading, not to infer the employer's working language.

## When to use this skill

- Search for job openings anywhere in Switzerland, by keyword and/or canton
- Filter Romandie (French-speaking Switzerland) postings by canton: **GE** Geneva,
  **VD** Vaud, **VS** Valais, **NE** Neuchâtel, **FR** Fribourg, **JU** Jura
- Filter by workload percentage (part-time vs. full-time)
- Get the full description of a specific job listing

## Commands

### Search job listings

```bash
bun run .agents/skills/job-room-search/cli/src/cli.ts search [flags]
```

Query syntax: double quotes are **ignored** — `--query '"chef de projet"'` and
`--query 'chef de projet'` both return 565 matches, so there is no phrase search and word order
still shifts the count (`'projet chef'` returns 537). Words inside one query are **ANDed**
(`'informaticien cuisinier'` returns 0). `OR`, `AND` and a leading `-` are **not operators** —
they are matched as literal words, so `'informaticien OR cuisinier'` returns 0 rather than the
union. `*` **is** a wildcard (`'informatici*'` returns 137 against `'informaticien'` 68).
Matching is case-insensitive. The API itself ORs multiple entries in its `keywords` array
(`["informaticien","cuisinier"]` returns 245 = 68 + 177 exactly), but `--query` sends a single
entry, so run several short searches instead of one long one. All counts probed live on
12 November 2026.

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). Optional but recommended.
- `--canton <codes>` — comma-separated canton codes, e.g. `GE,VD`. Romandie codes: `GE` Geneva, `VD` Vaud, `VS` Valais, `NE` Neuchâtel, `FR` Fribourg, `JU` Jura. Omit for all of Switzerland.
- `--workload-min <n>` / `--workload-max <n>` — workload percentage bounds (0-100).
- `--page <n>` — 1-indexed page number.
- `--size <n>` / `--limit <n>` / `-n <n>` — results per page (default 20).
- `--sort <mode>` — `date_desc` (default) or `date_asc`. (`relevance` is rejected by the live API.)
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/job-room-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the job-room UUID from `search` results (e.g.
`e75c4b4a-ff96-477c-908b-91fd6416fdfc`) — **not numeric** like LinkedIn job IDs. You
may also pass a URL/string containing the UUID. Returns the full description (in the
best-available language, preferring fr → de → en → it), workload, permanence, and the
original external listing URL if the posting is syndicated.

## Usage examples

```bash
# Data engineer roles in Geneva/Vaud
bun run .agents/skills/job-room-search/cli/src/cli.ts search -q "data engineer" --canton GE,VD --format table

# Full-time nursing roles across all of Romandie
bun run .agents/skills/job-room-search/cli/src/cli.ts search -q "infirmier" --canton GE,VD,VS,NE,FR,JU --workload-min 80 --format table

# Any role, all Switzerland, most recent first
bun run .agents/skills/job-room-search/cli/src/cli.ts search -q "product manager" --format table

# Full details for a specific listing
bun run .agents/skills/job-room-search/cli/src/cli.ts detail e75c4b4a-ff96-477c-908b-91fd6416fdfc --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from job-room.ch's public `jobadservice` JSON API — no credentials required.
- **robots.txt, fetched 11 November 2026** (https://www.job-room.ch/robots.txt, HTTP 200), in full:

  ```
  # Do not crawl Job Adverts
  User-agent: *
  User-agent: AdsBot-Google
  Disallow: /job-search/

  # Exclude confirmation pages and similar
  User-agent: *
  Disallow: /aav/confirmation
  ```

  By path, the only `Disallow` rules are `/job-search/` (the human-facing search UI) and
  `/aav/confirmation`. This skill requests neither; it uses `/jobadservice/api/`, which no
  rule names. Stated plainly, though: the file's own comment reads *"Do not crawl Job
  Adverts"*, so the operator's intent is broader than the path it disallows. The path rules
  permit this; the comment asks for restraint. Hence personal-use scope, low volume, and
  `enabled: false` by default. This reading is the contributor's, not a ruling from SECO.
- **Terms of use on automated reads — checked in a real browser, 12 November 2026.**
  job-room.ch has **no terms-of-use page of its own**: `/nutzungsbedingungen`,
  `/conditions-utilisation`, `/terms-of-use` and `/legal` all redirect to the home page, and the
  site's only legal link points to SECO's
  [Legal information](https://www.arbeit.swiss/en/legal-information) on arbeit.swiss. (Those
  routes return HTTP 200 with an empty Angular shell to any non-browser client, so a plain
  `curl` cannot tell a real page from a missing one — this was read with a rendered browser.)

  That SECO page **says nothing at all about automated access, scraping, crawling, bots or
  APIs**. What it does say, verbatim, is about reuse, and it names job ads explicitly:

  > "Downloading or copying texts, job advertisements, illustrations, photos or other files does
  > not entail any transfer of rights with regard to the content thereof." … "Elements may be
  > reproduced only with the prior written consent of the copyright holders." … "The copying
  > and/or modification of the design for public or commercial purposes is likewise forbidden."

  Note the ambiguity rather than resolving it in our own favour: the same page states that it
  "pertains exclusively to the content accessible at www.work.swiss", yet job-room.ch links it
  as its legal information and the page's own "Supported browsers" section names
  `www.job-room.ch`. So whether it governs this API is genuinely unclear.

  Practical reading: **reading** postings for your own job search is not what the copyright
  clause restricts; **reproducing or redistributing** them is, and that needs prior written
  consent. There is no clause granting automated access either, so treat the silence as absence
  of permission rather than permission. That, with the robots.txt comment above, is why this
  skill ships personal-use scope and `enabled: false`. Commercial or bulk use: ask SECO first.
- Many listings **syndicate from other Swiss job boards** (most commonly jobup.ch, or
  direct employer career pages) — see `jobContent.externalUrl` in `detail` output. The
  same role may be independently discoverable on the origin site; dedupe on
  `(title, company)` if merging job-room results with another source.
- Full field/DTO reference (all probed body fields, response paths, quirks): see
  `url-reference.md` in this skill directory.
