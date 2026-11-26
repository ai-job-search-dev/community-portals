# rippling-cli

CLI for searching one company's public [Rippling](https://www.rippling.com) job
board (`https://ats.rippling.com/<slug>/jobs`).

**Data source**: Rippling's board JSON API — `/api/v2/board/<slug>/jobs` for the
listing, `/api/v1/board/<slug>/jobs/<id>` for one posting.
**Authentication**: None. Board reads are public.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only
installs dev tooling (`typescript`, `@types/bun`).

> **Per-company board.** Rippling hosts many employers' careers pages; pass the
> board slug (`--board rippling`) or the careers URL
> (`--board https://ats.rippling.com/rippling/jobs`). There is no global
> Rippling job search.
>
> The board API is not part of Rippling's documented developer REST API
> (`rest.ripplingapis.com`, token-authenticated company records) and has no
> published contract, so it may change without notice. A failed request or a
> board-level schema change exits non-zero with a JSON error; individual rows
> missing a title or a usable URL are skipped. It never follows a redirect off
> `ats.rippling.com`.

## Installation

```bash
cd .agents/skills/rippling-search/cli
bun install   # optional — installs dev tooling (typescript, @types/bun)
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | List a company's open postings, with optional keyword filtering |
| `detail` | Fetch one posting by its search-result id or public URL |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` with exit code `1`.

Search reads the board up to 10 pages of 1,000 **listing rows** (a multi-location
posting is one row per location, so unique postings are fewer), because the API
has no keyword search and filtering and paging are client-side. It then emits
`{ "meta": { "count", "page", "total" }, "results": [...] }`.
Each result has `id`, `title`, `company`, `company_slug`, `location`, `locations`,
`date`, `url` and `department`; `detail` adds `date` (`createdOn`), the employer's
real name, `employment_type`, `salary` and the cleaned `description`.

Two diagnostics are warnings, not errors: `JOBAGE_UNSUPPORTED` (the board has no
posting date, so `--jobage` cannot filter) and `SEARCH_TRUNCATED` (the walk ended
before the board did — the 10,000-listing-row page cap, or a board whose own
count exceeds the rows it returned — so unseen postings may match). Both print
JSON on stderr and leave stdout a valid document, exit `0`.

## Quick examples

```bash
# Engineering roles at Rippling
bun run src/cli.ts search --board rippling -q "engineer" --limit 10 --format table

# Everything a company advertises
bun run src/cli.ts search --board just-appraised-jobs --format table

# One posting's full detail
bun run src/cli.ts detail rippling/84d388b6-7656-434c-8862-0312eb6b97ac --format plain
```

See `../SKILL.md` for the flag reference and `../url-reference.md` for the
endpoint shapes.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--board` | `-b` | **Required.** Board slug or `https://ats.rippling.com/<slug>/jobs` URL. |
| `--query` | `-q` | Keywords; every word must appear in the title, department or a location. Quotes are ignored (no exact phrase), no OR. |
| `--page` | | 1-indexed page of the filtered results. Default 1. |
| `--limit` | `-n` | Results per page. Default 25. |
| `--jobage` | | Accepted but unsupported: the board has no posting date, so it warns and ignores the value. |
| `--remote` | | `remote` \| `hybrid` \| `onsite` (`on-site` accepted); comma = OR (`remote,hybrid`). A bare `--remote` means `remote`. A posting matches if any of its locations has the type. |
| `--format` | | `json` \| `table` \| `plain`. |

## Detail arguments

| Argument | Alias | Description |
|----------|-------|-------------|
| `<slug/id>` | | The `id` from a search result, or a full posting URL. |
| `--board` | `-b` | Board slug, needed only when passing a bare posting id. |
| `--format` | | `json` \| `plain`. |

## Data quirks

- Search results have `date: null`; only `detail` exposes `createdOn`.
- Search results carry the board slug as `company`; `detail` reports the
  employer's real name.
- A posting with several locations is one result with the labels joined by ` · `.
- `salary` keeps its period (`USD 185000–240000/year`); compare within one period.
