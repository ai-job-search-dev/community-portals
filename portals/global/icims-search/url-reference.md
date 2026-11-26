# iCIMS hosted portals — URL reference

Recorded 2026-11-26 from live responses against `careers-usu`, `careers-primehealthcare`,
`careersat-ohsu` (with postings on `externalcareers-ohsu`) and `jobs-selectmedicalcorp`.
No unauthenticated public API: the portals render server-side HTML, and iCIMS's
official APIs need per-customer credentials (see the other surfaces below).

## Hosts

| Host | Role |
|------|------|
| `<portal>.icims.com` | The employer's career portal. `<portal>` is the employer-chosen label (`careers-usu`, `jobs-selectmedicalcorp`, `externalcareers-ohsu`, ...). |

Every request the CLI makes is to a `*.icims.com` host. Only two paths are requested.
Posting links may point at a sibling portal host; the posting URL's own host is used.

`robots.txt` (sampled 2026-11-26):

```
User-agent: *
Sitemap: https://careers-primehealthcare.icims.com/sitemap.xml
Disallow: /jobs/*referral
Disallow: /jobs/referral
Disallow: /jobs/*login
Disallow: /jobs/login
Disallow: /jobs/*candidate
Disallow: /jobs/candidate
Disallow: /jobs/reminder
Disallow: /connect
Disallow: /connect/*interest
Disallow: /connect/interest
Disallow: /connect/*resume
Disallow: /connect/resume
```

`/jobs/search` and `/jobs/<id>/<slug>/job` are allowed; the CLI requests nothing else.
A redirect is followed only when its `Location` is still `https://*.icims.com` on a
`/jobs...` path (at most five hops); anything else is refused with an error.

## Endpoints

| Purpose | Request |
|---------|---------|
| Search page | `GET /jobs/search?ss=1&pr=<0-based page>&in_iframe=1` |
| Search with keywords | `GET /jobs/search?ss=1&pr=<n>&in_iframe=1&searchKeyword=<text>&searchRelation=keyword_all` |
| Posting page | `GET /jobs/<id>/<slug>/job?in_iframe=1` (the slug is optional: `/jobs/<id>/job?in_iframe=1` works) |

`in_iframe=1` returns the portal-only markup without the employer's site chrome.

## Parameters (CLI → portal)

| CLI flag | Portal | Notes |
|----------|--------|-------|
| `--portal` | host label / URL | Validated as `^[a-z0-9][a-z0-9_-]{0,62}$` or any URL on an `https://*.icims.com` host (the homepage or a `/jobs...` page; the host is the portal). Never any other host. |
| `--query` | `searchKeyword` + `searchRelation=keyword_all` | Server-side. AND over words, any order; double quotes = exact phrase; single quotes ignored; `OR`/`-term` not supported. |
| `--location` | — | Client-side substring: the portal's own location filter needs option IDs from its search form. |
| `--remote` | — | Client-side workplace filter: a card field labelled telework/remote/workplace (`remote`/`hybrid`/`onsite`; `No` → `onsite`), else a location containing `Remote`. Undeclared cards match nothing. |
| `--jobage` | — | Client-side on the card's posted date; a card with no printed date is kept (there is nothing to compare). |
| `--page` | `pr` | 1-indexed CLI, 0-based portal. Page size is the portal's (20 or 50 observed). |
| `--limit` | — | Client-side cap after filtering. |

## Search page anchors

- Card list: `<ul class="container-fluid iCIMS_JobsTable">` with one
  `<li class="iCIMS_JobCardItem">` per posting. The parser splits on the
  `iCIMS_JobCardItem` token.
- Posting link: `<a class="iCIMS_Anchor" href=".../jobs/<id>/<slug>/job?in_iframe=1">`.
  The href may be absolute, relative, or on a sibling `*.icims.com` host.
- Title: `<h3>` inside the anchor (attributes are themed by some portals). Fallback:
  the anchor's `title="<id> - <title>"`.
- Posted date: `<span class="sr-only field-label">Posted Date</span>` followed by a
  span whose `title` holds the full date (`11/25/2026 4:02 PM`); the visible text is
  relative ("3 hours ago"). Not every portal prints it.
- Location: a `<dt>` in `additionalFields` whose label contains "Location"
  ("Location", "Job Location", "Job Locations") with the value in the sibling
  `<dd>`, e.g. `US-UT-Brigham City`. Fallback: the card's header-left
  `field-label` ("City", "Location") and the span after it. A "Facility" label is
  not a location.
- Workplace (optional): a `<dt>` labelled "Telework Eligible", "Remote",
  "Workplace", "Work Arrangement", "Work Type" or "Location Type". Values seen:
  `Hybrid`, `No`; `Remote` may say `Yes`. When the portal prints no such field, a
  location containing `Remote` (e.g. `US-Remote`) is the only signal.
- Page count: `<h2 class="iCIMS_SubHeader iCIMS_SubHeader_Jobs">Search Results
  Page 1 of N</h2>`. A zero-result page prints no header.

## Posting page anchors

- Posting metadata: `<script type="application/ld+json">` with a schema.org
  `JobPosting` node: `title`, `datePosted`, `validThrough`, `employmentType`,
  `hiringOrganization.name`, `jobLocation[].address`, `description` (HTML), `url`.
  The `type` attribute is not always the first attribute (CSP nonces), so the
  parser matches it anywhere in the tag. Some portals emit an array or an
  `@graph` document.
- Readable body fallback (no JSON-LD): the `iCIMS_InfoMsg_Job` blocks, cut before
  the `iCIMS_JobOptions` (Options/Apply) block.
- Title fallback: `<h1 class="iCIMS_Header">`.
- Header fields: `<dt class="iCIMS_JobHeaderField">` + `<dd class="iCIMS_JobHeaderData">`
  pairs. The requisition ID label is "Requisition ID" or "ID"; location is under a
  label containing "Location".
- A closed job or a wrong slug can answer `200` with the portal's error/list page.
  That page has no `JobPosting` node and no `<h1 class="iCIMS_Header">`, which is
  how the parser reports `NOT_FOUND`. A removed posting can answer `404` or `410`.

## Other iCIMS surfaces checked (2026-11-26)

- **Official Job Portal API** — `https://api.icims.com/customers/{customerId}/search/portals/{portalIdOrName}`
  plus `.../filters` and `.../portalposts/...`, and the Search API. Documented at
  developer-community.icims.com. Every call needs a customer ID and Basic or
  `x-icims-v1-hmac-sha256` credentials (verified: no header → HTTP 401); the
  Search API also needs an Integration User. Not reachable by a zero-auth,
  per-employer portal; a keyed mode would ship `enabled: false` per CONTRIBUTING.
- **Standard XML Feed for Job Boards** — vendor-only: OAuth 2.0 onboarding, a
  200–500 MB zip three times a day, and customers can opt out. Not usable here.
- **`GET /sitemap.xml`** — public where present (`careers-usu` listed 198 entries,
  `careers-primehealthcare` 3,312; `careersat-ohsu` answered 403 from its WAF). It
  carries job URLs and a `lastmod` page-update time, no title, location,
  description or query support, so it cannot answer a search without one posting
  fetch per URL. Kept as an enumeration fallback only; the CLI does not use it.
- **No RSS or JSON variant** — `/jobs/rss`, `/jobs.rss`, `?rss=true`, `?rss=1`,
  `?format=rss`, `?output=rss`, `?mode=json`, and `Accept: application/json` all
  return the ordinary HTML search page.

## Mapping to the portal-skill contract

Search: `id` ← numeric id in the posting URL, `title` ← card `<h3>`, `company` ←
portal host label, `location` ← location field (portal string, e.g.
`US-UT-Brigham City`), `date` ← card posted date as `YYYY-MM-DD` (`null` when the
portal prints none), `url` ← posting URL with its query stripped, `workplace` ←
the card's telework/remote field or a `Remote` location (`null` when the portal
declares neither).

Detail adds `description` ← JSON-LD `description` (or the page body) as text,
`employmentType` ← JSON-LD `employmentType` (`null` for `OTHER`/`UNAVAILABLE`),
`requisitionId` ← header field, and `workplace` ← JSON-LD `jobLocationType:
TELECOMMUTE`, else the telework/remote header field or a `Remote` location.
`location` falls back to the header field when the JSON-LD address is absent;
`UNAVAILABLE` parts (iCIMS's placeholder) are dropped.

## Live samples

- Search: `GET https://careers-usu.icims.com/jobs/search?ss=1&pr=0&in_iframe=1`
- Keyword search: `.../jobs/search?ss=1&pr=0&in_iframe=1&searchKeyword=registered%20nurse&searchRelation=keyword_all`
- Posting: `GET https://careers-usu.icims.com/jobs/11021/biology-teaching-assistant/job?in_iframe=1`
- Posting by ID only: `GET https://careers-usu.icims.com/jobs/11021/job?in_iframe=1`
- Sibling-host link: `careersat-ohsu` lists postings on `externalcareers-ohsu.icims.com`.

## Quirks

- Page size is not fixed across portals: 20 and 50 both observed, so pagination
  trusts the portal's own "Page X of N" and never computes it.
- Query semantics were verified by comparing the portal's own page counts:
  `nurse california` → 5 pages, `"nurse california"` → 0, `"california nurse"` → 1,
  `'nurse california'` → 5, `nurse OR pharmacist` → 0. Hence: quotes are phrase
  delimiters, single quotes are literal/ignored, AND is implicit, no OR.
- `posted date` is a portal-locale `M/D/YYYY`; a day and month both ≤ 12 is read
  as US order.
- The JSON-LD `hiringOrganization.name` is `UNAVAILABLE` on some portals; the
  portal label is used for `company` instead.
- `validThrough` is a rolling +1 year on sampled portals, so it is not treated as
  a real application deadline and is not returned.
