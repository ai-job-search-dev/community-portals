---
name: oraclecloud-search
version: 1.0.0
description: >
  Use this skill to search an employer's Oracle Recruiting Cloud (ORC) careers
  site or look up one of its postings, when the careers site runs on Oracle
  Fusion HCM (hosts like *.fa.oraclecloud.com, *.fa.<region>.oraclecloud.com,
  *.fa.ocs.oraclecloud.com or *.fa.ocs.oraclecloud<NN>.com, and paths under
  /hcmUI/CandidateExperience/.../sites/...). Large employers such as JPMorgan
  Chase, BNY Mellon, American Express, Honeywell and Oracle itself use ORC.
  Trigger phrases: Oracle Recruiting Cloud jobs, ORC job search, oraclecloud.com
  careers, hcmUI CandidateExperience, Fusion HCM careers, look up this Oracle
  Recruiting Cloud posting, search this ORC board.
  Not for boards that are not ORC: check the URL first.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/oraclecloud-search/cli/src/cli.ts *)
---

# Oracle Recruiting Cloud Search Skill

Search the live job postings of any employer whose careers site runs on
**Oracle Recruiting Cloud (ORC)**, the recruiting front end of Oracle Fusion
Cloud HCM. It uses the public `recruitingCEJobRequisitions` and
`recruitingCEJobRequisitionDetails` REST endpoints — the same JSON the
employer's careers site loads. No authentication, no API key and **zero runtime
dependencies**: it runs with just `bun`.

ORC has **no global index**: each employer has its own pod host and site
number, so every search names one. This skill searches that board and reads its
postings; it does not discover boards.

## ⚠️ Personal use only

This reads the public job API behind an employer's ORC careers site. Keep volume
low, do not bulk-collect, and run it on your own responsibility. The employer's
terms and the host's `robots.txt` apply. Oracle's REST API reference labels these
Recruiting CE endpoints as "only for Oracle internal use"; they are reachable
without authentication and are what the public careers site loads, but that note
is a terms caveat, so keep this to personal use. The CLI requests only the ORC
REST endpoints under `/hcmRestApi/` and never crawls the careers pages.

## ⚠️ One board per employer

ORC hosts differ by tenant, and the site number is employer-specific. Read the
board from the employer's own careers page ("Search jobs" / "View openings"
usually lands on `/hcmUI/CandidateExperience/<lang>/sites/<site>/jobs`). Do not
guess a site number: a tenant that does not recognise one can silently fall
back to its default site instead of returning an error.

## When to use this skill

- Search an employer's ORC board by keyword, then filter by location or age
- Get the full description, posting date, deadline and employment type of one
  posting
- Check whether a specific ORC posting is still open (a closed posting returns
  `NOT_FOUND`)

**Check the board first.** If the employer's careers page is not on an
`*.oraclecloud[NN].com` host, this skill is the wrong tool — use the portal for
whatever platform it actually runs on (Greenhouse, Lever, Workday, LinkedIn, a
local board).

## Commands

### Search job listings

```bash
bun run .agents/skills/oraclecloud-search/cli/src/cli.ts search --board "<board>" [--query "<text>"] [flags]
```

Query syntax: phrase quoting not honoured — quote characters are ignored and match the same as bare text; no documented boolean operators (the words `AND`, `OR` and `NOT` are passed as ordinary search terms); word order affects ranking, so pass one plain term per call.

Key flags:
- `--board <board>` / `-b <board>` — **required.** The employer's ORC site, as
  - its careers URL:
    `https://<host>/hcmUI/CandidateExperience/<lang>/sites/<site>/jobs`
    (the `/jobs` suffix is optional), e.g.
    `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs`, or
  - the bare `<host>/<site>`, e.g. `jpmc.fa.oraclecloud.com/CX_1001` (language
    defaults to `en`), or
  - `<host>/<lang>/<site>`, e.g. `jpmc.fa.oraclecloud.com/fr/CX_1001`.
- `--query <text>` / `-q <text>` — keywords, passed to the board's own search.
  Optional; without it the board lists its newest postings. Oracle's search is
  relevance-ranked, so the order is not strictly newest-first when `--query` is
  set. Commas and semicolons are rejected because they are the finder grammar's
  own separators.
- `--location <text>` / `-l <text>` — case-insensitive substring match on the
  posting's location string. Client-side: it filters the page fetched, not the
  whole board.
- `--location-id <id>` — optional numeric ORC location id, passed to the
  board's finder. Only some tenants (the upstream provider names BNY Mellon and
  American Express) need one to scope results; leave it unset normally.
- `--page <n>` — page number (1-indexed, 20 results per page, fixed).
- `--jobage <days>` — keep postings dated within N days. Sent to the board as
  `postingStartDate`, then applied to the returned page as well; undated
  postings are dropped.
- `--limit <n>` / `-n <n>` — cap the results this call prints (client-side).
- `--format json|table|plain` — default `json`.

Every option is single-value: repeating one (or mixing a short and long spelling,
e.g. `-q a --query b`) exits `BAD_ARG` rather than silently searching one value.

> **Location**: ORC's server-side location filter uses opaque per-board numeric
> ids. `--location` matches the location string on the page fetched; put a city
> in `--query` too when it helps ranking. `--location-id` passes one of those
> numeric ids to the finder for the few tenants that require it (notably BNY
> Mellon and American Express, per the upstream ORC provider); leave it unset
> for boards that do not.

### Fetch full job detail

```bash
bun run .agents/skills/oraclecloud-search/cli/src/cli.ts detail <job-url> [--format json|plain]
```

`job-url` is the `id` (same as `url`) from a search result, e.g.
`https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210675973`.
A URL on any other host, or a path that is not a `/job/<id>` posting, is
rejected with `BAD_ID` before any request. Returns the full description (with
the responsibilities and qualifications sections ORC tenants sometimes split
out), posting date, deadline when the tenant sets one, employment type, every
listed location, and the canonical posting URL.

---

## How to use effectively

**Always start with `search`.** Two steps are usually enough:

1. Find the careers URL on the employer's careers page, and search it.
2. Call `detail` with a shortlisted result's `url` only when you need the full ad.

**Narrow by keyword, not by location flag.** `--query "data engineer"` works
well; then read `location` in the results. Oracle's search is not a strict AND:
word order changes which postings rank, so one plain term per call gives the
most predictable set.

**`--location` filters the page fetched, not the whole board; `--jobage` is
sent to the board as `postingStartDate` and also filters the page.** A local
posting can sit on a later page, so page through (or narrow `--query`) when
location matters. `--jobage` already scopes the board, but the page filter still
drops undated rows.

**`meta.total` is the board's own count for the query.** `meta.count` is the
number of rows this call emitted after filters and `--limit`.

**Table for scanning, JSON for ids.** The table shows the requisition id
instead of the full URL; the JSON `id`/`url` is what `detail` accepts.

---

## Usage examples

### Software engineer roles at JPMorgan Chase

```bash
bun run .agents/skills/oraclecloud-search/cli/src/cli.ts search \
  --board jpmc.fa.oraclecloud.com/CX_1001 \
  --query "software engineer" \
  --format table
```

### New York roles from the careers URL, last 14 days

```bash
bun run .agents/skills/oraclecloud-search/cli/src/cli.ts search \
  --board "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs" \
  --location "New York" \
  --jobage 14 \
  --format table
```

### Page 2 of a board-wide listing

```bash
bun run .agents/skills/oraclecloud-search/cli/src/cli.ts search \
  --board jpmc.fa.oraclecloud.com/CX_1001 \
  --page 2 \
  --format json
```

### Full details for a specific posting

```bash
bun run .agents/skills/oraclecloud-search/cli/src/cli.ts detail \
  "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210675973" \
  --format plain
```

---

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, reading `id`/`url` for `detail` |
| `table` | Quick human-readable overview and scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is
`{ "meta": { "count", "total", "page", "perPage" }, "results": [...] }`; each
result has `id`, `title`, `company`, `location`, `date`, `url`, and
`description` (always `null` in search — use `detail`). All errors are written
to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with
code `1`.

---

## Notes

- Data is ORC's public JSON API — no credentials required. Oracle documents the
  underlying HCM REST endpoints, but the Candidate Experience finder grammar is
  not a stable, versioned contract and can change without notice.
- In search, `company` is the board's tenant slug (the first host label, e.g.
  `jpmc`); the list API does not expose a display name. `detail` uses
  `LegalEmployer`, then `Organization` when the tenant exposes one, and falls
  back to the tenant slug.
- Hosts are pinned to Oracle's pod family:
  `<tenant>.fa.oraclecloud.com`, `<tenant>.fa.<region>.oraclecloud.com`,
  `<tenant>.fa.ocs.oraclecloud.com`, and the same shapes on
  `oraclecloud<NN>.com` (NN is 1–99). **Branded ORC hosts on an employer's own
  domain** (e.g. Dell's `enterpriseplatform.dell.com`) are not supported; none
  of this family resolves there.
- Page size is fixed at 20. `meta.total` is the board's own count for the
  query. There is no sort flag; requests ask for `POSTING_DATES_DESC`, which
  most tenants honour for an empty query but not always for a keyword search.
- `date` is the exact `PostedDate` (`YYYY-MM-DD`). `detail` prefers
  `ExternalPostedStartDate`; `deadline` is set only when the tenant provides
  `ExternalPostedEndDate`.
- Some tenants front the API with a WAF (Imperva and others) that answers
  `403`, `503` or `504` to non-browser clients or cloud egress IPs. That is an
  environment/IP issue, not a parser bug: the same request can succeed from a
  residential connection. The CLI sends an honest User-Agent and does not
  impersonate a browser.
- `robots.txt` is per tenant and is sometimes answered `403` by that WAF, so
  the CLI cannot verify it in general. It stays on the JSON endpoints the
  careers site itself uses and never fetches careers pages.
- Retries 429/5xx with exponential backoff. A retired or restricted tenant
  commonly answers `401` or `403`; a closed posting answers `404`, which
  `detail` reports as `NOT_FOUND`.
- Search only: this skill reads postings and never applies to them.
