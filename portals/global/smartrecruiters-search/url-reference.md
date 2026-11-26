# SmartRecruiters Posting API — URL reference

Recorded 2026-11-26 from live responses against the `BoschGroup` board. Official
docs: https://developers.smartrecruiters.com/docs/posting-api,
https://developers.smartrecruiters.com/docs/endpoints and
https://developers.smartrecruiters.com/docs/customer-overview

The Customer API overview lists the **Posting API** as one of the endpoints
available **without authentication** (the other is Common Elements). The
Customer **Jobs API** (`/jobs`, documented at
https://api.smartrecruiters.com/jobs/api-docs) is a different API: it needs an
`x-smarttoken` API key or OAuth and is not used here.

## Hosts

| Host | Role |
|------|------|
| `api.smartrecruiters.com` | Public Posting API. What the CLI calls. |
| `jobs.smartrecruiters.com` | Human-facing boards and postings (`/<slug>`, `/<slug>/<id>-<title>`). Accepted as `detail` input and used for the result `url`. |
| `careers.smartrecruiters.com` | Legacy careers host. Accepted as `detail`/`--board` input, parsed but never fetched: in a browser it redirects to the employer's branded careers site. |
| Employer domains | Branded boards (e.g. `jobs.bosch.com`). Their URLs carry no SmartRecruiters slug, so they are not accepted. |

`robots.txt`: `jobs.smartrecruiters.com/robots.txt` is 404 (no crawl rules).
`api.smartrecruiters.com/robots.txt` answers `Disallow: /` to `User-agent: *`
and allows `/v1/companies/` to LinkedInBot. The Customer API overview still
lists the Posting API as available without authentication, and the CLI stays on
the documented `/v1/companies/<slug>/postings` JSON endpoints and the keyless
`/v1/companies/<slug>/departments` probe; it never fetches the HTML careers
pages. Use is also governed by the SAP API Policy linked from
https://developers.smartrecruiters.com/docs/the-smartrecruiters-platform.

## Endpoints

| Purpose | Request |
|---------|---------|
| List postings | `GET /v1/companies/{slug}/postings?limit={n}&offset={n}&destination=PUBLIC[&q={text}][&city={name}][&country={code}][&region={name}][&locationType=REMOTE\|HYBRID\|ONSITE][&releasedAfter={iso}]` |
| One posting | `GET /v1/companies/{slug}/postings/{id}` |
| Board existence probe | `GET /v1/companies/{slug}/departments` (keyless Common Elements endpoint) |

The list endpoint also accepts `department`, `language` and
`custom_field.<id>` filters. This CLI exposes `city`, `country` and `region`
directly (`--city`, `--country`, `--region`); they are exact values from the
board, applied server-side. Free-text `--location` first tries the same value
as an exact city filter; if the board has no such city, it falls back to a
client-side substring match on the page fetched and prints a
`PAGE_SCOPED_FILTER` warning on stderr.

Errors: an unknown company identifier answers HTTP 200 with
`{ "totalFound": 0, "content": [] }` on `/postings`; when a search is empty the
CLI probes `/v1/companies/{slug}/departments`, which answers HTTP 404 for an
unknown identifier, and reports `BOARD_NOT_FOUND`. An unknown or removed posting
answers HTTP 404; a closed posting that SmartRecruiters still serves returns a
detail object with `active: false`. Both are documented in `SKILL.md`.

The Customer API overview throttles at 10 requests/second and 8 concurrent
requests. The CLI does not paginate automatically: a `search` reads only the page
selected by `--page`, then may make an optional city probe and page fallback for
`--location`, plus a `/departments` probe when the final page is empty, so repeat
`--page` to scan further. Requests are sequential, 429/5xx responses are retried
with backoff, and each request may take up to 128 s as the overview asks.

## Parameters (CLI → API)

| CLI flag | API | Notes |
|----------|-----|-------|
| `--board` | path `{slug}` | Validated `^[A-Za-z0-9._-]{1,100}$`, never `.` or `..`; a careers/jobs/API/posting URL is reduced to its slug |
| `--query` | `q` | Server-side keyword search over job title and location; relevance-ranked |
| `--city` | `city` | Server-side exact city filter, whole board |
| `--country` | `country` | Server-side ISO 3166-1 alpha-2 filter, whole board; lowercased (the API is case-sensitive) |
| `--region` | `region` | Server-side exact region filter, whole board |
| `--remote` | `locationType` | Server-side workplace filter, whole board; `remote`/`hybrid`/`onsite` (`on-site` accepted), comma = OR; repeated `locationType` values |
| `--location` | `city` first, then — | First tries the value as an exact city (server-side, whole board); if no city matches, filters the page fetched and warns `PAGE_SCOPED_FILTER`. If `--city` is set, the city-first step is skipped and this is always page-scoped |
| `--jobage` | `releasedAfter` | Server-side cutoff, whole board; the client also checks `releasedDate` |
| `--page` | `offset` | `(page - 1) * 20`; the CLI always fetches 20 rows |
| `--limit` | — | Client-side: caps the rows emitted after filters |
| — | `limit` | Fixed at 20 (the API caps it at 100) |
| — | `destination` | Fixed at `PUBLIC`; internal postings need OAuth and are out of scope |

## List item fields

`id` (string, numeric or UUID), `uuid`, `name`, `refNumber` (employer
requisition id), `releasedDate` (ISO 8601), `unpublishOn` (ISO 8601, only
default job ads with an auto-unpublish schedule), `visibility` (`PUBLIC`),
`company.{identifier,name}`, `location.{city,region,country,address,postalCode,
remote,hybrid,fullLocation}`, `department.{id,label,description}` (often `{}`),
`function.{id,label}`, `industry.{id,label}`, `typeOfEmployment.{id,label}`,
`experienceLevel.{id,label}`, `language.code`, `ref` (an **API** URL),
`customField[]`, `defaultJobAd`, `jobAdId`.

- `typeOfEmployment.label` is "Full-time", "Contract", ... while
  `experienceLevel.id` can be `internship`; that level decides the printed
  employment type.
- `country` is a lowercase ISO alpha-2 code (`my`, `de`); `fullLocation` is the
  display string when present. When `fullLocation` is absent, the CLI expands
  the code to its English name (`de` → Germany) with `Intl.DisplayNames`.
- `unpublishOn` is the scheduled auto-unpublish date, present only on default
  job ads with a schedule. The CLI maps it to `deadline` in both search and
  detail output.

## Detail-only fields

- `jobAd.sections.{companyDescription,jobDescription,qualifications,
  additionalInformation}.{title,text}` — each `text` is HTML. All four are
  optional; a board fills only the sections it uses. A `videos` section may also
  be present; the CLI does not map it.
- `active` — `false` for a posting SmartRecruiters still serves but has closed.
- `compensation` — `{ min, max, currency, period }` with `period` one of
  `HOURLY`, `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`; mapped as `compensation`.
- `postingUrl`, `applyUrl` — public URLs; `applyUrl` usually carries `?oga=true`.
- `jobId`, `jobAdId`, `creator`, `customField[]`.

## Mapping to the portal-skill contract

`id` ← `id`, `title` ← `name`, `company` ← `company.name` ?? board slug,
`location` ← `location.fullLocation` ?? assembled `city, region, country`, with
`Remote` appended when `location.remote` is true, `date` ← `releasedDate`,
`deadline` ← `unpublishOn`, `compensation` ← `compensation`,
`url` ← `https://jobs.smartrecruiters.com/<slug>/<id>-<slugified name>` (or the
detail payload's `postingUrl` when it is on that host).
