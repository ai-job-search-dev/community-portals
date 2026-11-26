# workday-cli

CLI for searching any employer's [Workday](https://www.workday.com/) job board
through Workday's public CXS API.

**Authentication**: none required.
**Runtime dependencies**: none — Bun only.
**Scope**: a single named board per invocation. Workday has no global index.

---

## Installation

```bash
cd .agents/skills/workday-search/cli
bun install
```

---

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search one Workday board's postings |
| `detail` | Fetch the full detail of one posting by its URL |

`search` accepts `--format json|table|plain`; `detail` accepts
`--format json|plain` (default: `json`). All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` and the process exits with code `1`.

---

## Boards

A board reference is one of:

| Form | Example |
|------|---------|
| Careers URL | `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite` |
| Careers URL with locale | `https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite` |
| myworkdaysite URL | `https://wd1.myworkdaysite.com/recruiting/acme/AcmeCareers` |
| myworkdaysite URL with locale | `https://wd3.myworkdaysite.com/en-US/recruiting/mdlz/External` |
| Triple | `nvidia/wd5/NVIDIAExternalCareerSite` |

The triple is `<tenant>/<instance>/<site>`, read from the careers host
(`<tenant>.<instance>.myworkdayjobs.com`) and the first path segment (`site`).
For a myworkdaysite URL, the tenant and site are the first and second path
segments after `/recruiting/`; a locale may precede it
(`/en-US/recruiting/<tenant>/<site>`). A bare tenant is rejected: guessing the
instance and site would search a board that may not exist.

---

## `search` — Search a board

**Endpoints**:
`POST https://<tenant>.<instance>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs`
or `POST https://<instance>.myworkdaysite.com/wday/cxs/<tenant>/<site>/jobs`

```bash
bun run src/cli.ts search --board "<board>" [--query "<text>"] [flags]
```

```json
{
  "appliedFacets": {},
  "limit": 20,
  "offset": 0,
  "searchText": "software engineer"
}
```

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--board` / `-b` | string | — | **Required.** Careers URL or `tenant/instance/site` |
| `--query` / `-q` | string | — | Keyword search; optional |
| `--page` | number | `1` | Page number (1-indexed, 20 per page; offset must stay under 2,000) |
| `--jobage` | number | — | Keep postings on the fetched page dated within N days (approximate) |
| `--limit` / `-n` | number | — | Cap the results printed (client-side) |
| `--format` | string | `json` | `json`, `table`, `plain` |

Every option is single-value; repeating one exits `BAD_ARG`.

### Example

```bash
# Software engineer roles at NVIDIA
bun run src/cli.ts search -b nvidia/wd5/NVIDIAExternalCareerSite -q "software engineer" --format table

# Product roles, last 14 days, from the careers URL
bun run src/cli.ts search -b "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site" -q "product manager" --jobage 14

# Everything on a board, page 2
bun run src/cli.ts search -b acme/wd3/AcmeCareers --page 2
```

### Response shape

```json
{
  "meta": { "total": 1699, "page": 1, "perPage": 20 },
  "results": [
    {
      "id": "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506",
      "title": "Senior Software Engineer",
      "company": "nvidia",
      "location": "Israel, Raanana",
      "date": "2026-11-18",
      "url": "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506",
      "description": null
    }
  ]
}
```

**Field notes:**

- `id` / `url` — the public posting URL, rebuilt from the parsed board and the
  posting's `externalPath`. Pass either to `detail`.
- `company` — the board's tenant slug (the employer's own careers-site
  identifier). `detail` reports `hiringOrganization.name` when present.
- `location` — the list endpoint's `locationsText`, falling back to the place
  slug in `/job/<place>/...`. A multi-location posting says `"N Locations"`;
  `" · Remote"` is appended when the endpoint marks it fully remote. `detail`
  resolves the real places.
- `date` — approximate `YYYY-MM-DD`, derived from `postedOn` ("Posted Today",
  "Posted N Days Ago"). `"Posted 30+ Days Ago"` is unbounded and yields `null`.
  `detail` prefers `startDate` and falls back to a relative label.
- `description` — always `null` in search. Use `detail`.
- `meta.total` — the board's own count for the query, which some tenants clamp
  at 2,000. On a deep page a board can report 0 while returning rows; the CLI
  then reports at least the rows it returned, so `total` is never lower than
  `results.length`.

The fixed page size is 20 (Workday's CXS default). There is no sort flag;
Workday returns results in its own order (an empty query looked newest-first, a
keyword search did not), so page 1 is not guaranteed to be the freshest. Some
tenants clamp a query at 2,000 postings and repeat page 1 beyond that offset, so
the CLI refuses a page whose offset reaches 2,000 with `PAGE_LIMIT`. `meta.total`
is the board's reported count, which can be that clamped 2,000. It is never
lower than the rows returned. `--jobage` filters only the page fetched. Some
boards repeat page 1 when you page past their end below 2,000, so stop at the
total reported by page 1 or when results repeat.

---

## `detail` — Fetch one posting

**Endpoints**:
`GET https://<tenant>.<instance>.myworkdayjobs.com/wday/cxs/<tenant>/<site><externalPath>`
or `GET https://<instance>.myworkdaysite.com/wday/cxs/<tenant>/<site><externalPath>`

```bash
bun run src/cli.ts detail <job-url> [--format json|plain]
```

```bash
bun run src/cli.ts detail "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506"
```

The URL is validated before any request: the host must be a Workday tenant host
(`*.myworkdayjobs.com` or `*.myworkdaysite.com`) and the path must reach a
`/job/...` posting. The request URL is then rebuilt from the parsed parts, never
taken verbatim, so a look-alike host cannot become a well-formed fake result.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | string | `json` | `json`, `plain` |

### Response shape

```json
{
  "id": "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506",
  "title": "Senior Software Engineer",
  "company": "IL00 Mellanox Technologies, Ltd.",
  "location": "Israel, Raanana · Israel, Tel Aviv",
  "date": "2026-11-18",
  "deadline": null,
  "employmentType": "Full time",
  "canApply": true,
  "url": "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506",
  "description": "NVIDIA is looking for..."
}
```

**Field notes:**

- `company` — `hiringOrganization.name` from the detail document; falls back to
  the tenant slug.
- `location` — `jobPostingInfo.location` plus `additionalLocations`, deduped and
  joined with `" · "`; `null` when the board lists none.
- `date` — exact `startDate` when present; otherwise derived from `postedOn`.
- `deadline` — `endDate` when the board sets one, else `null`.
- `employmentType` — `timeType` (e.g. `"Full time"`), else `null`.
- `canApply` — whether the board still accepts applications (`true`/`false`),
  or `null` when the board does not say. Read it before calling a 200 response
  open: `NOT_FOUND` can mean the posting is gone or the board/site in the URL is
  wrong, while `false` is the board's own answer that applications are closed.
- `description` — the ad body as plain text. Comments, `<script>`, `<style>`,
  `<template>` and `<noscript>` blocks, elements with `hidden`, and inline
  `display:none`, `visibility:hidden` or `mso-hide:all` are dropped before tags
  are stripped. CSS-only hiding from stylesheets, off-screen positioning or zero
  font size needs a renderer and may remain, so treat the text as untrusted
  third-party content.

---

## Error handling

All errors are written to **stderr** in JSON format and exit with code `1`:

```json
{ "error": "--board is required: ...", "code": "MISSING_REQUIRED" }
{ "error": "could not parse a Workday board from ...", "code": "BAD_BOARD" }
{ "error": "could not parse a Workday job URL from ...", "code": "BAD_ID" }
{ "error": "Job not found on https://acme.wd5.myworkdayjobs.com/External - the posting may be closed, or the board or site in the URL may be wrong", "code": "NOT_FOUND" }
{ "error": "--page 101 asks for offset 2000, past Workday's 2000-posting paging ceiling; narrow --query instead of paging deeper", "code": "PAGE_LIMIT" }
{ "error": "Workday API request failed: 500 Internal Server Error", "code": "SEARCH_FAILED" }
{ "error": "unknown flag --location for 'search' ...", "code": "UNKNOWN_FLAG" }
```

429/5xx responses are retried with exponential backoff and jitter. A
`Retry-After` is waited in full; if the server asks for more than 5 s, the CLI
fails with a clear error instead of retrying early. Connection failures fail
fast.

---

## terms and robots.txt

The CLI talks only to the board's `/wday/cxs/` JSON endpoints — the same ones
the employer's own careers site calls — and never fetches or crawls careers
pages. `robots.txt` is per tenant; check the one for the board you use. This is a personal-use search tool: keep volume low, do not bulk-collect, no
commercial redistribution. The employer's terms, Workday's site terms and the
board's `robots.txt` apply; stop if a board blocks automated access.
