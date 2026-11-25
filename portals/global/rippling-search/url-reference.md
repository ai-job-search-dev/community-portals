# Rippling board API — endpoint reference

Rippling publishes each customer's job board at `https://ats.rippling.com/<slug>/jobs`
and serves its data as JSON from the same origin. These board endpoints are not
part of Rippling's documented developer REST API
([developer.rippling.com](https://developer.rippling.com/documentation/rest-api),
the token-authenticated `rest.ripplingapis.com` platform API for a company's own
records — its recruiting endpoints expose requisitions and candidates, not the
public careers board). There is no published contract for the board API; this
documents what the careers pages use and this CLI reads. Everything below was
verified against live boards (`rippling`, `just-appraised-jobs`) in November 2026.

## Board listing (search)

```
GET https://ats.rippling.com/api/v2/board/<slug>/jobs?page=<n>&pageSize=<n>
```

- `page` is **0-indexed**.
- `pageSize` accepts up to **1000**; 2000 answers `400 Bad Request`.
- No keyword, department, location or date parameters. Filtering is client-side.
- The endpoint returns one item **per location**, so a posting with three locations
  appears three times with the same `id` and `url`. Deduplicate by `id`/`url` and
  merge `locations`.

Response:

```json
{
  "items": [
    {
      "id": "84d388b6-7656-434c-8862-0312eb6b97ac",
      "name": "Business Operations Manager",
      "url": "https://ats.rippling.com/rippling/jobs/84d388b6-7656-434c-8862-0312eb6b97ac",
      "department": { "name": "Bizops", "displayName": "Bizops" },
      "locations": [
        {
          "name": "San Francisco, CA",
          "country": "United States",
          "countryCode": "US",
          "state": "California",
          "stateCode": "CA",
          "city": "San Francisco",
          "workplaceType": "ON_SITE"
        }
      ],
      "language": "en-US"
    }
  ],
  "page": 0,
  "pageSize": 1000,
  "totalItems": 736,
  "totalPages": 1
}
```

- `totalItems` counts rows, not postings (locations inflate it).
- No company name and no posting date in this payload.
- `workplaceType` is one of `ON_SITE`, `REMOTE`, `HYBRID`.

## Single posting (detail)

```
GET https://ats.rippling.com/api/v1/board/<slug>/jobs/<id>
```

Response fields this CLI reads (the payload carries more, including the
application form):

```json
{
  "uuid": "84d388b6-7656-434c-8862-0312eb6b97ac",
  "name": "Business Operations Manager",
  "description": {
    "company": "<div>About the company …</div>",
    "role": "<div>About the role …</div>"
  },
  "workLocations": ["San Francisco, CA", "New York, NY"],
  "department": { "name": "Bizops", "base_department": "Bizops" },
  "employmentType": { "label": "SALARIED_FT", "id": "Salaried, full-time" },
  "createdOn": "2026-03-31T17:37:26.093000-07:00",
  "url": "https://ats.rippling.com/rippling/jobs/84d388b6-7656-434c-8862-0312eb6b97ac",
  "board": { "slug": "rippling", "title": "Current Openings" },
  "payRangeDetails": [
    { "location": "US", "currency": "USD", "frequency": "YEAR", "rangeStart": 185000, "rangeEnd": 240000, "isRemote": false }
  ],
  "companyName": "Rippling",
  "unlistedFromSearch": false
}
```

- `description.company` and `description.role` are HTML; the two are concatenated
  and cleaned before output.
- `createdOn` is the only date the API exposes; the list endpoint does not carry
  it, which is why search results have `date: null`.
- `employmentType.id` is the human label; `label` is the internal code.
- `payRangeDetails` may be empty; `frequency` is `YEAR`, `HOUR`, ….
- `companyName` (or `board.companyName` where present) is the only place the
  employer's display name appears — the board listing has none.

## Errors

- Unknown board slug: `404` with
  `{"error_code":"RESOURCE_NOT_FOUND","message":"Job Board not found","resource":null}`.
- Unknown posting id on a real board: also `404`.
- `pageSize` above 1000: `400`.

The CLI maps a `404` to `BOARD_NOT_FOUND` (search) or `NOT_FOUND` (detail), and
never reports it as an empty result set.

## robots.txt

`https://ats.rippling.com/robots.txt`:

```
User-agent: *
Disallow: /internal/
```

The board pages and the `/api/v1/board/` and `/api/v2/board/` paths are allowed.
This skill stays on those paths: no crawl of the marketing site, no
`/internal/`, no application or submission endpoints.

## Notes for maintainers

- The API sits behind Cloudflare and ignores the `User-Agent` (an empty UA still
  answered 200), but the CLI sends an honest
  `Mozilla/5.0 (compatible; rippling-search/1.0)`.
- Requests use `redirect: "error"` so a redirect cannot move the CLI off
  `ats.rippling.com`.
- There is no board-metadata endpoint: `/api/v2/board/<slug>` and
  `/api/v1/board/<slug>` both answer 404. The slug alone identifies the tenant.
- The listing is cheap to over-fetch (one 300 KB response for a 736-row board at
  `pageSize=1000`), which is why search walks the whole board instead of guessing
  where matches are.
