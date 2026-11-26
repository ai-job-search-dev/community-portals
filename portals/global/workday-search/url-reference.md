# Workday URL Reference

Workday has no public global index. Every employer gets a tenant, and often
several sites (external careers, campus, internal) on that tenant.

## Finding a board

Open the employer's careers page and follow its "Search jobs" / "View openings"
link. Workday boards have one of these shapes:

```
https://<tenant>.<instance>.myworkdayjobs.com/<site>
https://<tenant>.<instance>.myworkdayjobs.com/<locale>/<site>
https://<instance>.myworkdaysite.com/recruiting/<tenant>/<site>
```

Examples:

```
https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite
https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite
https://salesforce.wd12.myworkdayjobs.com/External_Career_Site
https://wd1.myworkdaysite.com/recruiting/acme/AcmeCareers
https://wd3.myworkdaysite.com/en-US/recruiting/mdlz/External
```

| Part | Form | Where it comes from | Example |
|------|------|---------------------|---------|
| `tenant` | `myworkdayjobs.com` | first host label | `nvidia` |
| `tenant` | `myworkdaysite.com` | first path segment after `/recruiting/` | `acme` |
| `instance` | both | host label matching `wd<number>` | `wd5` |
| `site` | `myworkdayjobs.com` | first path segment after an optional locale | `NVIDIAExternalCareerSite` |
| `site` | `myworkdaysite.com` | segment after `<tenant>` in `/recruiting/<tenant>/<site>` | `AcmeCareers` |

The CLI also accepts the bare triple `<tenant>/<instance>/<site>`.

A bare tenant is rejected on purpose: the instance (`wd1`, `wd5`, `wd12`, …)
and the site name (`External_Career_Site`, `NVIDIAExternalCareerSite`, …) are
employer-specific, and guessing them searches a board that may not exist.

## Endpoints

### Search

```
POST https://<tenant>.<instance>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs
POST https://<instance>.myworkdaysite.com/wday/cxs/<tenant>/<site>/jobs
Content-Type: application/json
```

```json
{
  "appliedFacets": {},
  "limit": 20,
  "offset": 0,
  "searchText": "software engineer"
}
```

| Field | Meaning |
|-------|---------|
| `appliedFacets` | Per-board facet ID map; this CLI sends `{}` |
| `limit` | Page size (20 is Workday's default) |
| `offset` | `(page - 1) * limit` |
| `searchText` | Keyword text, passed through unchanged |

Response:

```json
{
  "total": 1699,
  "jobPostings": [
    {
      "title": "Senior Software Engineer",
      "externalPath": "/job/Israel-Raanana/Senior-Software-Engineer_JR2016506",
      "locationsText": "Israel, Raanana",
      "postedOn": "Posted 7 Days Ago",
      "remoteType": "Fully Remote",
      "bulletFields": ["JR2016506"]
    }
  ],
  "facets": []
}
```

- `total` is the board's count for this query. Some tenants clamp it at 2,000
  while their facet counts show a larger board, and answer offset 2000 with the
  same rows as offset 0. The CLI refuses offsets at or above 2,000. A smaller
  board can also repeat page 1 when paged past its end, so stop at the first
  page's `total` or when results repeat.
- `jobPostings[].postedOn` is relative prose only. `"Posted 30+ Days Ago"` is
  unbounded; the CLI maps it to `date: null`.
- `locationsText` may be a placeholder such as `"2 Locations"`.
- `remoteType`, when present, can be `"Fully Remote"`.
- `facets` carries board-specific location/job-family IDs with counts. The IDs
  are opaque and per board, so this CLI does not expose facet filters.
- There is no server-side sort parameter; results come in Workday's own order
  (an empty query looked newest-first; a keyword search did not).

### Detail

```
GET https://<tenant>.<instance>.myworkdayjobs.com/wday/cxs/<tenant>/<site><externalPath>
GET https://<instance>.myworkdaysite.com/wday/cxs/<tenant>/<site><externalPath>
```

No request body. Response (abridged, verified live 2026-11-25):

```json
{
  "jobPostingInfo": {
    "title": "Senior Software Engineer",
    "jobDescription": "<p>NVIDIA is looking for ...</p>",
    "location": "Israel, Raanana",
    "additionalLocations": ["Israel, Tel Aviv"],
    "postedOn": "Posted 7 Days Ago",
    "startDate": "2026-11-18",
    "timeType": "Full time",
    "jobReqId": "JR2016506",
    "externalUrl": "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506",
    "canApply": true
  },
  "hiringOrganization": { "name": "IL00 Mellanox Technologies, Ltd." }
}
```

- `startDate` is the exact posting date (`YYYY-MM-DD`); prefer it over
  `postedOn`.
- `endDate` appears on boards that set an application deadline.
- `canApply` says whether the board still accepts applications. Read it before
  calling a 200 response open: a 404 can mean the posting is gone or that the
  board/site in the URL is wrong, while `false` is the board's own answer that
  applications are closed.
- `location` + `additionalLocations` are the real places behind a search
  placeholder.
- `jobDescription` is HTML; the CLI strips it to plain text.
- `hiringOrganization.name` is the legal/employer name, when present.

## Notes on access

- Workday's documented APIs (`developer.workday.com`) are tenant-authenticated
  and scoped to a customer's own records; they do not serve a public job board.
  This portal uses the unauthenticated CXS JSON the careers sites load.
- Both endpoints are public and unauthenticated — the same JSON the employer's
  careers site loads.
- A retired or restricted board typically answers `401`, `403` or `422`; a
  missing site answers `404`.
- `robots.txt` is per tenant. The CLI requests only `/wday/cxs/` endpoints and
  never fetches careers pages.
