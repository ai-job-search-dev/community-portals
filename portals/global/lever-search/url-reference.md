# Lever Postings API — URL reference

Recorded 2026-11-25 from live responses against board `leverdemo`.
Official docs: https://github.com/lever/postings-api

Lever's other developer documentation (`hire.lever.co/developer/documentation`)
covers the **authenticated v1 Data API** (candidates, opportunities, webhooks),
not this public v0 Postings feed.

## Hosts

| Host | Role |
|------|------|
| `jobs.lever.co`, `jobs.eu.lever.co` | Human-facing board pages (`/<slug>/<uuid>`, `/apply`). Accepted as `detail` input; never fetched by the CLI. |
| `api.lever.co` | Public Postings API (US region). What the CLI calls. |
| `api.eu.lever.co` | Public Postings API (EU region), selected by `--region eu` or an EU URL. |

`robots.txt` on both API hosts: `User-agent: * / Allow: /` with `Crawl-delay: 1`.
No authentication is required for GET. `jobs.lever.co` serves a Cloudflare-managed
robots.txt that restricts named bots but allows `User-agent: *`; the CLI does not read it.

## Endpoints

| Purpose | Request |
|---------|---------|
| Whole board | `GET /v0/postings/{slug}?mode=json` → JSON array of postings, descriptions inlined |
| Paged board | `GET /v0/postings/{slug}?mode=json&limit=100&skip=0` → up to `limit` postings from `skip` |
| One posting | `GET /v0/postings/{slug}/{posting-id}?mode=json` → one posting object |

Unknown slug or posting → HTTP 404 with body `{"ok":false,"error":"Document not found"}`.
`mode=json` is pinned explicitly even though the endpoint currently answers JSON without
it; `html`, `iframe` and `xml` (the XML job feed) also exist, but the CLI reads JSON only.
`limit`/`skip` are honoured; the unpaged response carries the entire board, so the
CLI pages to keep each response small.

## Parameters (CLI → API)

| CLI flag | API | Notes |
|----------|-----|-------|
| `--board` | path `{slug}` | Validated `^[A-Za-z0-9._-]{1,100}$`, never `.` or `..` |
| `--query` | — | Client-side: all words in `text` (title) |
| `--location` | — | Client-side: substring of the merged location string |
| `--remote` | — | Client-side: `remote`/`hybrid`/`onsite` (`onsite` also matches `on-site`). A posting with a missing or `unspecified` type matches `remote` only when its location says Remote; a known type never falls back |
| `--jobage` | — | Client-side: `createdAt` |
| `--page` | — | Client-side: 20 by default, newest first |
| `--limit` | — | Client-side: results per page; also caps emitted |
| `--region` | host | `us` / `eu` |

## Posting fields

- `id` (UUID), `text` (title), `hostedUrl`, `applyUrl`
- `createdAt` (epoch **milliseconds**), `country` (`US`, `DE`, ...)
- `workplaceType` (`remote` | `hybrid` | `on-site` | `unspecified`). Lever's docs
  spell it `on-site`, but live responses also return `onsite` (observed on
  `palantir`, `spotify`, `unlimit` and `leverdemo` on 2026-11-25); the CLI prints
  the value as sent and only special-cases `remote`.
- `categories`: `{ commitment, department, location, team, allLocations[] }`.
  `location` is one primary city; `allLocations` carries the full set.
- `description`, `descriptionPlain` — intro HTML / plain text
- `lists[]`: `{ text, content }`, where `content` is an HTML fragment of `<li>` items
  (requirements, "within 1 month", ...)
- `additional`, `additionalPlain` — trailing copy (benefits, EEO statement, ...)
- `opening`, `openingPlain`, `descriptionBody`, `descriptionBodyPlain` — also present;
  not used, the three fields above cover the reader-visible posting in page order.
- `salaryRange` (only when the employer publishes pay):
  `{ min, max, currency, interval }`, e.g. `{ min: 85000, max: 175000,
  currency: "USD", interval: "per-year-salary" }`. Observed intervals include
  `per-year-salary`, `per-month-salary` and `per-hour-wage`; the CLI keeps the raw
  interval rather than guessing an annualization.
- `salaryDescription`, `salaryDescriptionPlain` — optional pay blurb (HTML/plain);
  not used, the structured range is enough for `detail`.

There is no company display name in the payload. The board slug is used as `company`.

## Mapping to the portal-skill contract

`id` ← `id`, `title` ← `text`, `company` ← board slug, `location` ←
`categories.location` + `categories.allLocations` (deduped, plus `Remote` when
`workplaceType === "remote"`), `date` ← `createdAt` as ISO 8601, `url` ← `hostedUrl`
when it is an absolute `http:`/`https:` URL; otherwise
`https://jobs[.eu].lever.co/<slug>/<id>`, using the EU host for `--region eu` or an EU URL.

Detail adds `description` (the three text fields joined), `department`, `team`,
`employmentType` ← `categories.commitment`, `country`, `salary` ← `salaryRange`,
and `applyUrl` (only when it is an absolute `http:`/`https:` URL).

## Live samples

- Board: `GET https://api.lever.co/v0/postings/leverdemo?mode=json&limit=1`
- Posting: `GET https://api.lever.co/v0/postings/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b?mode=json`
- Unknown slug/posting: same paths → HTTP 404 `{"ok":false,"error":"Document not found"}`
