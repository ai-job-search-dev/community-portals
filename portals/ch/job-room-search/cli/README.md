# job-room-cli

CLI for searching jobs on [job-room.ch](https://www.job-room.ch) — the official Swiss
federal job platform, operated by SECO (State Secretariat for Economic Affairs) as the
Public Employment Service behind the ORP/RAV offices.

**Base URL**: `https://www.job-room.ch/jobadservice/api/`
**Authentication**: None required.
**Format**: Public JSON REST API. Search is a `POST` with a JSON body; detail is a `GET`
by UUID. Zero runtime dependencies — it runs with just `bun`.

---

## Installation

```bash
cd .agents/skills/job-room-search/cli
bun install
```

---

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain`; `detail` accepts `--format json|plain` (default: `json`).

Errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.
The one exception is running the CLI with no command at all: that prints usage to stdout and exits `1`,
as `--help` does, because there is no operation to report an error about.

Unknown flags, bare value-taking flags, unexpected positional arguments, and out-of-range values are
rejected before any request is made — a silently dropped filter changes what the search returns.
That includes `--page 0` and `--size 0`, which are refused rather than clamped to `1`, and a
`--canton` value such as `,` that contains no canton code.

Requests retry with exponential backoff and jitter on `429` and `5xx`, six attempts in total.
A `Retry-After` header is honoured when present (capped at 30s), with the backoff schedule as the
fallback. Each request has a 15s timeout.

---

## `search` — Search for job listings

**Endpoint**: `POST https://www.job-room.ch/jobadservice/api/jobAdvertisements/_search`

```bash
bun run src/cli.ts search [flags]
```

`--query` is optional: an empty query returns the newest postings for the given filters.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--query` / `-q` | string | — | Keyword search (title, skill, role) |
| `--canton` | string | — | Comma-separated canton codes, e.g. `GE,VD`. Romandie: `GE`, `VD`, `VS`, `NE`, `FR`, `JU` |
| `--workload-min` | number | — | Minimum workload percentage (0-100). API default is `10` |
| `--workload-max` | number | — | Maximum workload percentage (0-100). API default is `100` |
| `--page` | number | `1` | Page number (1-indexed). Must be at least `1` |
| `--size` / `--limit` / `-n` | number | `20` | Results per page. Must be at least `1` |
| `--sort` | string | `date_desc` | `date_desc` or `date_asc`. `relevance` is rejected by the API with a `400` and is refused locally |
| `--format` | string | `json` | `json`, `table`, or `plain` |

### Examples

```bash
bun run src/cli.ts search -q "data engineer" --canton GE,VD --format table
bun run src/cli.ts search -q "infirmier" --canton VD,VS,NE,FR,JU --workload-min 80 --format table
bun run src/cli.ts search --canton GE --size 50 --format json
```

---

## `detail` — Fetch one listing

**Endpoint**: `GET https://www.job-room.ch/jobadservice/api/jobAdvertisements/<id>`

```bash
bun run src/cli.ts detail <id|url> [--format json|plain]
```

IDs are UUIDs, not numeric:

```bash
bun run src/cli.ts detail e75c4b4a-ff96-477c-908b-91fd6416fdfc --format plain
```

Detail adds the full description, every available language version, the street address,
work forms, start/end dates, and the apply channel.

Every result, from both commands, also carries `reportingObligation` and
`reportingObligationEndDate` — the job registration requirement as the API reports it. See the
note below on why these never show an in-window posting.

---

## Notes

- **The five-day window is not visible to this CLI.** Under the Swiss job registration
  requirement (*Stellenmeldepflicht* / *obligation d'annonce*), a covered vacancy must be
  reported here and may not be advertised elsewhere for five working days, exclusively to
  RAV/ORP-registered jobseekers. That window is real but it belongs to a logged-in user on the
  website: probed anonymously on 12 November 2026, every registration-obligation ad the API
  returned had `reportingObligationEndDate` **already in the past**, and 500 consecutive ads
  were all `PUBLISHED_PUBLIC` with none under obligation. So obligation ads reach this API after
  their window closes, not during it. `reportingObligation` and `reportingObligationEndDate` are
  surfaced on every result, which makes a just-closed window usable as a freshness signal.
  `../SKILL.md` has the measurements.
- **Syndicated listings.** Many postings arrive from commercial boards (jobup.ch among
  them) and carry a `jobContent.externalUrl`. The same role may appear on both, so dedupe
  by title + company when aggregating across portals.
- **Multilingual descriptions.** Listings carry one description per language. The CLI
  prefers `fr`, then `de`, `en`, `it`, and falls back to whatever is present.
- **Highlight markup.** The search API wraps matched keywords in `<em>` tags and
  HTML-entity-encodes free-text fields; both are cleaned before output.

---

## User-Agent

The CLI identifies itself:

```
job-room-search/1.0 (+https://github.com/ai-job-search-dev/community-portals)
```

It does not impersonate a browser. Checked on 11 November 2026, the `jobadservice` search
endpoint answers `200` to this UA exactly as it does to a spoofed desktop-Chrome string, so
there is nothing to gain by disguising the client and an operator reading their logs can see
what this is. The value is `UA` in `src/helpers.ts`.

## robots.txt and terms

`robots.txt` (fetched 11 November 2026, HTTP 200) disallows `/job-search/` — the human-facing
search UI, which this CLI does not touch — and `/aav/confirmation`. No rule names the
`/jobadservice/` API path used here. But the file opens with:

```
# Do not crawl Job Adverts
```

so the operator's intent is broader than the path it disallows. The path rules permit this; the
comment asks for restraint, which is why the skill ships personal-use scope and `enabled: false`.

On terms: job-room.ch has no terms-of-use page of its own, and SECO's linked legal information
says nothing about automated access — but its copyright clause does name job advertisements and
requires "prior written consent" to reproduce them. Reading postings for your own job search is
not what that restricts; redistributing them is. `../SKILL.md` has the quotes, the dates and the
ambiguity over whether that page governs this API at all; `../url-reference.md` has the
robots.txt findings in full.

---

## Error codes

| Code | Meaning |
|------|---------|
| `UNKNOWN_FLAG` | A flag name this command does not accept |
| `BAD_ARG` | A flag value that is missing, malformed, out of range, or an unexpected positional argument |
| `BAD_CMD` | Not `search` or `detail` |
| `NO_ID` | `detail` called without an id or URL |
| `BAD_ID` | No job-room UUID could be parsed from the given id or URL |
| `NOT_FOUND` | The API returned 404 for that id |
| `SEARCH_FAILED` / `DETAIL_FAILED` | Non-200 response, or a transport/parse failure |
| `INTERNAL_ERROR` | Unexpected throw not caught by a command |

## Tests

```bash
bun test
```

Tests are network-free: the CLI contract and flag-validation cases all fail before any
request is made, the parsing tests run against trimmed fixtures of real API responses, and the
retry and hidden-text suites stub `fetch`.

`tests/hidden-text.test.ts` is the one worth knowing about. Listing text is third-party data, so
every result is passed through `stripInvisible` (copied from `linkedin-search`) at the output
boundary, and that suite asserts no invisible character survives in **any** format — `json`,
`table` and `plain` for `search`, `json` and `plain` for `detail` — including an "Ignore previous
instructions" payload spelled in Unicode tag characters, which renders as nothing in a terminal
but reaches a model reading the output. Remove the `stripInvisible` call and all six cases fail.
