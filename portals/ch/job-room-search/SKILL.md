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

## Why this portal deserves priority in a Swiss job search

job-room.ch is the SECO / public employment service platform, and Swiss law gives it a
structural advantage no commercial board has. Under the **job registration requirement**
(Stellenmeldepflicht / obligation d'annonce), an employer filling a vacancy in a covered
occupation must report it here and **may not advertise it anywhere else for five working
days**. That window is exclusive to jobseekers registered with the RAV/ORP.

For a RAV-registered user this is a real head start: covered roles appear here *before*
jobup.ch, LinkedIn or the employer's own careers page, and applying inside the window means
a much smaller applicant pool. The covered-occupation list is revised annually and was
expanded on 1 January 2026, taking coverage from roughly 6.5% to 10.8% of the workforce.

Practical consequence: in a Swiss fork, run this portal **first**, and search all relevant
cantons in one call rather than just the home canton, e.g. all of Romandie with
`--canton GE,VD,VS,NE,FR,JU`.

### Three API gotchas worth knowing

1. **`detail` needs the full UUID.** `--format table` truncates the id to eight characters,
   and feeding that back returns `{"error":"Could not parse a job-room UUID","code":"BAD_ID"}`.
   Use `--format json` to get the full `id` before any `detail` call.
2. **No explicit job-registration flag exists in the API.** The closest usable signal is
   **`externalUrl`**: when present, the posting is already syndicated publicly (commonly from
   jobup.ch), so it is *not* exclusive. A result with **no `externalUrl`** and a recent
   `publicationStart` is plausibly still inside the exclusive window. This is a heuristic —
   report it as plausible, never as confirmed.
3. **Keyword relevance is loose, and multi-word queries degrade badly.** A query like
   `"sécurité information"` returns largely unrelated postings (the API appears to match
   terms loosely), while a single compound term like `"cybersécurité"` returns relevant ones.
   Related queries also return inconsistent sets from the same corpus, so a role can surface
   under one term and not under a near-synonym. Run **several short queries** rather than one
   precise long one, and filter client-side.

`languageIsoCode` on each result gives the posting language directly, which is more reliable
than inferring it from the title — though not perfect (French-titled postings occasionally
carry `"de"`), so treat a mismatch as inconclusive.

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
  `robots.txt` disallows crawling the human-facing `/job-search/` UI but does not
  restrict this separate `jobadservice` API path.
- Many listings **syndicate from other Swiss job boards** (most commonly jobup.ch, or
  direct employer career pages) — see `jobContent.externalUrl` in `detail` output. The
  same role may be independently discoverable on the origin site; dedupe on
  `(title, company)` if merging job-room results with another source.
- Full field/DTO reference (all probed body fields, response paths, quirks): see
  `url-reference.md` in this skill directory.
