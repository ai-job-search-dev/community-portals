# oraclecloud-cli

CLI for searching any employer's [Oracle Recruiting Cloud](https://www.oracle.com/human-capital-management/recruiting/)
(ORC) careers site through Oracle's public `recruitingCEJobRequisitions` REST
API.

**Authentication**: none required.
**Runtime dependencies**: none — Bun only.
**Scope**: a single named board per invocation. ORC has no global index.

---

## Installation

```bash
cd .agents/skills/oraclecloud-search/cli
bun install
```

---

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search one ORC board's postings |
| `detail` | Fetch the full detail of one posting by its URL |

`search` accepts `--format json|table|plain`; `detail` accepts
`--format json|plain` (default: `json`). All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` and the process exits with code `1`.

---

## Boards

A board reference is one of:

| Form | Example |
|------|---------|
| Careers URL | `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs` |
| Careers URL without `/jobs` | `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001` |
| `<host>/<site>` | `jpmc.fa.oraclecloud.com/CX_1001` |
| `<host>/<lang>/<site>` | `jpmc.fa.oraclecloud.com/fr/CX_1001` |

The host must be an ORC pod host:

```
<tenant>.fa.oraclecloud.com
<tenant>.fa.<region>.oraclecloud.com
<tenant>.fa.ocs.oraclecloud.com
<tenant>.fa.ocs.oraclecloud<NN>.com     (NN 1-99)
```

A bare host is rejected: the site number is employer-specific, and guessing it
would search a site that may not exist. Branded ORC hosts on an employer's own
domain (e.g. `enterpriseplatform.dell.com`) are not supported.

---

## `search` — Search a board

**Endpoint**:
`GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions`

```bash
bun run src/cli.ts search --board "<board>" [--query "<text>"] [flags]
```

The request uses the Candidate Experience finder:

```
finder=findReqs;siteNumber=<site>,facetsList=<facets>,limit=20,sortBy=POSTING_DATES_DESC,offset=<offset>[,locationId=<id>][,postingStartDate=<date>][,keyword=<query>]
```

Paging params are set in both the finder and the top level, because some
tenants honour only one. The `expand` parameter is included because without it
some tenants return a total but no requisition list.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--board` / `-b` | string | — | **Required.** Careers URL or `<host>/[<lang>/]<site>` |
| `--query` / `-q` | string | — | Keywords, passed to the board's own search |
| `--location` / `-l` | string | — | Case-insensitive substring match on the page's location strings |
| `--location-id` | string | — | Numeric ORC location id for tenants that require one to scope results |
| `--page` | number | `1` | Page number (1-indexed, 20 per page) |
| `--jobage` | number | — | Keep postings dated within N days (sent as `postingStartDate`, also filtered on the page) |
| `--limit` / `-n` | number | — | Cap the results printed (client-side) |
| `--format` | string | `json` | `json`, `table`, `plain` |

Every option is single-value; repeating one exits `BAD_ARG`. `--query` rejects
commas, semicolons and control characters: they are the finder grammar's own
separators.

Some tenants (the upstream provider names BNY Mellon and American Express) need
a numeric `locationId` to scope results. Pass it with `--location-id`; a normal
search does not need one.

### Example

```bash
# Software engineer roles at JPMorgan Chase
bun run src/cli.ts search -b jpmc.fa.oraclecloud.com/CX_1001 -q "software engineer" --format table

# New York roles, last 14 days, from the careers URL
bun run src/cli.ts search -b "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs" -l "New York" --jobage 14

# Everything on a board, page 2
bun run src/cli.ts search -b acme.fa.us2.oraclecloud.com/CX_1 --page 2
```

### Response shape

```json
{
  "meta": { "count": 2, "total": 2005, "page": 1, "perPage": 20 },
  "results": [
    {
      "id": "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210808660",
      "title": "Software Engineer III - Databricks, Python Pyspark",
      "company": "jpmc",
      "location": "Mumbai, Maharashtra, India",
      "date": "2026-11-25",
      "url": "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210808660",
      "description": null
    }
  ]
}
```

**Field notes:**

- `id` / `url` — the public posting URL, rebuilt from the parsed board and the
  requisition `Id`. Pass either to `detail`.
- `company` — the board's tenant slug (the host's first label). ORC's public API
  does not expose the employer's display name.
- `location` — `PrimaryLocation`, then each `secondaryLocations[].Name`, joined
  with `" · "`; `Remote` / `Hybrid` is appended from `WorkplaceTypeCode`.
- `date` — exact `PostedDate` (`YYYY-MM-DD`), or `null`.
- `description` — always `null` in search. Use `detail`.
- `meta.total` — the board's own count for the query (`TotalJobsCount`).
  `meta.count` — rows emitted after filters and `--limit`.

Page size is fixed at 20. There is no sort flag; requests ask for
`POSTING_DATES_DESC`, which most tenants honour for an empty query but not
always for a keyword search. `--jobage` is sent to the board as
`postingStartDate` and also filters the returned page. `--location` filters only
the page fetched.

---

## `detail` — Fetch one posting

**Endpoint**:
`GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails/<id>?onlyData=true&expand=workLocation,secondaryLocations`

```bash
bun run src/cli.ts detail <job-url> [--format json|plain]
```

```bash
bun run src/cli.ts detail "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210675973"
```

The URL is validated before any request: the host must be an ORC pod host and
the path must reach a `/job/<id>` posting. The request URL is then rebuilt from
the parsed parts, never taken verbatim, so a look-alike host cannot become a
well-formed fake result.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | string | `json` | `json`, `plain` |

### Response shape

```json
{
  "id": "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210812363",
  "title": "Lead Software Engineer",
  "company": "jpmc",
  "location": "Palo Alto, CA, United States · New York, NY, United States · Jersey City, NJ, United States",
  "date": "2026-11-25",
  "deadline": null,
  "employmentType": "Full time",
  "url": "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210812363",
  "description": "Are you ready to shape ..."
}
```

**Field notes:**

- `company` — `LegalEmployer`, else `Organization`, else the tenant slug.
- `location` — `PrimaryLocation` plus each `secondaryLocations[].Name`, deduped
  and joined with `" · "`, plus a `Remote` / `Hybrid` hint.
- `date` — `ExternalPostedStartDate`, reduced to `YYYY-MM-DD`.
- `deadline` — `ExternalPostedEndDate` when the tenant sets one, else `null`.
- `employmentType` — `JobSchedule` (e.g. `"Full time"`), else `JobType`.
- `description` — the ad body as plain text. Some tenants split it across
  `ExternalDescriptionStr`, `ExternalResponsibilitiesStr` and
  `ExternalQualificationsStr`; the CLI renders `ExternalDescriptionStr` as the
  unlabelled body and the other two as labelled `Responsibilities` and
  `Qualifications` sections, falling back to `ShortDescriptionStr`. Comments,
  `<script>`, `<style>`, `<template>` and `<noscript>` blocks, elements with
  `hidden`, and inline `display:none`, `visibility:hidden` or `mso-hide:all` are
  dropped before tags are stripped. CSS-only hiding from stylesheets, off-screen
  positioning or zero font size needs a renderer and may remain, so treat the
  text as untrusted third-party content.

---

## Error handling

All errors are written to **stderr** in JSON format and exit with code `1`:

```json
{ "error": "--board is required: ...", "code": "MISSING_REQUIRED" }
{ "error": "could not parse an Oracle Recruiting Cloud board from ...", "code": "BAD_BOARD" }
{ "error": "could not parse an Oracle Recruiting Cloud job URL from ...", "code": "BAD_ID" }
{ "error": "Job not found on https://.../sites/CX_1001 - the posting may be closed, ...", "code": "NOT_FOUND" }
{ "error": "Oracle Recruiting Cloud API request failed: 500 Internal Server Error", "code": "SEARCH_FAILED" }
{ "error": "unknown flag --remote for 'search' ...", "code": "UNKNOWN_FLAG" }
```

429/5xx responses are retried with exponential backoff and jitter. A
`Retry-After` is waited in full; if the server asks for more than 5 s, the CLI
fails with a clear error instead of retrying early. Connection failures fail
fast.

---

## Terms and robots.txt

The CLI talks only to the board's `/hcmRestApi/` JSON endpoints — the same ones
the employer's careers site calls — and never fetches or crawls careers pages.
`robots.txt` is per tenant, and some hosts answer it with a WAF `403`, so it
cannot be verified for every board. Oracle's REST API reference labels these
Recruiting CE endpoints as "only for Oracle internal use"; that is a terms
caveat, so keep this to personal use. Keep volume low: this is a personal-use
search tool, not a bulk collector.
