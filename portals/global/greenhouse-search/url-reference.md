# Greenhouse Job Board API — URL reference

Recorded 2026-11-06 from live responses; fields re-checked 2026-11-16 against board `gitlab`.
Official docs: https://docs.greenhouse.io/job-board.html

## Hosts

| Host | Role |
|------|------|
| `job-boards.greenhouse.io`, `boards.greenhouse.io` | Human-facing board pages (`/<board>/jobs/<id>`). Accepted as `detail` input. |
| `job-boards.eu.greenhouse.io`, `boards.eu.greenhouse.io` | EU-region equivalents. |
| `boards-api.greenhouse.io` | Public Job Board API (US region). What the CLI calls. |
| `boards-api.eu.greenhouse.io` | Public Job Board API (EU region), selected by `--region eu` or an EU URL. |

`robots.txt` on `boards-api.greenhouse.io`: `User-agent: * / Disallow: /embed/`. Only `/embed/` is disallowed.
No authentication is required for GET.

## Endpoints

| Purpose | Request |
|---------|---------|
| Board info | `GET /v1/boards/{board}` → `{ name, content }` |
| List jobs | `GET /v1/boards/{board}/jobs` → `{ jobs: [...], meta: { total } }` (entire board, no paging) |
| List with descriptions | `GET /v1/boards/{board}/jobs?content=true` (~17x larger; not used) |
| One job | `GET /v1/boards/{board}/jobs/{id}?pay_transparency=true` |

Errors: unknown board or job → HTTP 404 with body `{"status":404,"error":"Job not found"}`.

## Parameters (CLI → API)

| CLI flag | API | Notes |
|----------|-----|-------|
| `--board` | path `{board}` | Validated `^[A-Za-z0-9_-]{1,100}$` |
| `--query` | — | Client-side: all terms in `title` |
| `--location` | — | Client-side: substring of `location.name` |
| `--jobage` | — | Client-side: `first_published` (fallback `updated_at`) |
| `--page` | — | Client-side: 20 per page, sorted newest first |
| `--limit` | — | Client-side: caps the page after slicing, so a page can return fewer than 20 |
| `--region` | host | `us` / `eu` |

## List item fields

`id` (number), `title`, `absolute_url`, `company_name`, `location.name` (semicolon-joined
for multi-location), `first_published`, `updated_at` (ISO 8601 with offset),
`requisition_id`, `internal_job_id`, `language`, `application_deadline` (usually null),
`metadata[]` (custom fields, e.g. Cost Center), `data_compliance[]`.

## Detail-only fields

- `content`: posting HTML that is **itself entity-escaped** (`&lt;p&gt;...`). Decode the
  entities once to get HTML, remove hidden markup, then strip tags and decode again.
  Named entities arrive double-escaped (`&amp;mdash;`), so each layer must decode in a
  single pass and know the common named entities (dashes, curly quotes, ™ etc.).
  `content` usually **embeds the pay block** too (`<div class="pay-range">`, with the
  blurb and label), with or without `pay_transparency=true`, so plain output appends a
  pay note only when the description lacks it.
- `departments[]`: `{ id, name, parent_id }`
- `offices[]`: `{ id, name, location }`
- `pay_input_ranges[]` (only with `pay_transparency=true`): `{ min_cents, max_cents,
  currency_type, title, blurb }`, where `blurb` is HTML and often states incentive and
  equity eligibility and "no application deadline" wording.
- `education`, `ai_disclaimer`, `ai_opt_out_request_url`

## Mapping to the portal-skill contract

`id` ← `String(id)`, `title` ← `title`, `company` ← `company_name`, `location` ←
`location.name`, `date` ← `first_published ?? updated_at`, `url` ← `absolute_url`.
