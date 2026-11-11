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
| `--page` | number | `1` | Page number (1-indexed) |
| `--size` / `--limit` / `-n` | number | `20` | Results per page |
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

---

## Notes

- **The five-day head start.** Under the Swiss job registration requirement
  (*Stellenmeldepflicht* / *obligation d'annonce*), an employer filling a vacancy in a
  covered occupation must report it here and may not advertise it elsewhere for five
  working days. For a jobseeker registered with the RAV/ORP, covered roles appear here
  before they reach commercial boards. See `../SKILL.md` for the detail.
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

## robots.txt

`robots.txt` disallows `/job-search/` — the human-facing search UI, which this CLI does
not touch. It says nothing about the `/jobadservice/` API path used here. See
`../url-reference.md` for the findings in full.

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
request is made, and the parsing tests run against trimmed fixtures of real API responses.
