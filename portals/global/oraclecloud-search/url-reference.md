# Oracle Recruiting Cloud URL Reference

Oracle Recruiting Cloud (ORC) is the candidate-experience front end of Oracle
Fusion Cloud HCM. Each employer runs its own pod host and names one or more
sites on it; there is no global index.

## Oracle references

- [Get all job requisitions](https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-recruitingcejobrequisitions-get.html)
- [Get all job requisition details in preview mode](https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-recruitingcejobrequisitiondetails-get.html)
- [Get a job requisition detail in preview mode](https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-recruitingcejobrequisitiondetails-id-get.html)
- [Get all recruitingCESites](https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-recruitingcesites-get.html)

The Oracle reference labels the Recruiting CE service endpoints as "only for
Oracle internal use." They are reachable without authentication and are the same
JSON the public careers sites load, but that note is a real terms caveat: this
skill is a personal-use reader, not a licensed integration.

## Finding a board

Open the employer's careers page and follow its "Search jobs" / "View openings"
link. ORC careers URLs have this shape:

```
https://<host>/hcmUI/CandidateExperience/<lang>/sites/<site>/jobs
```

Examples (verified shapes; not all boards are reachable from every network):

```
https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs
https://<tenant>.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs
https://<tenant>.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs
https://<tenant>.fa.ocs.oraclecloud26.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs
```

| Part | Form | Where it comes from | Example |
|------|------|---------------------|---------|
| `host` | `*.fa.oraclecloud.com` | hostname | `jpmc.fa.oraclecloud.com` |
| `host` | `*.fa.<region>.oraclecloud.com` | hostname, region label | `acme.fa.us2.oraclecloud.com` |
| `host` | `*.fa.ocs.oraclecloud.com` | hostname | `acme.fa.ocs.oraclecloud.com` |
| `host` | `*.fa.ocs.oraclecloud<NN>.com` | hostname, NN 1–99 | `acme.fa.ocs.oraclecloud26.com` |
| `lang` | path segment after `CandidateExperience` | `en`, `en-US`, `fr`, … | `en` |
| `site` | path segment after `sites` | usually `CX_1` or `CX_1001` | `CX_1001` |

The CLI also accepts the bare `<host>/<site>` (language defaults to `en`) and
`<host>/<lang>/<site>` forms. A bare host is rejected: guessing the site number
would search a site that may not exist.

The host regex is pinned to Oracle's pod family:

```
^[a-z0-9-]+\.fa\.(?:[a-z0-9-]+\.)?(?:ocs\.)?oraclecloud(?:[1-9][0-9]?)?\.com$
```

The numeric apex is bounded to 1–99 on purpose. Branded ORC hosts on an
employer's own domain (e.g. Dell's `enterpriseplatform.dell.com`) do not match
and are not supported.

## Site discovery

`GET https://<host>/hcmRestApi/resources/latest/recruitingCESites?onlyData=true&limit=50`
returns up to 50 items with `SiteNumber` and `SiteName`; follow `offset` with
`hasMore` to enumerate a larger collection. It was verified on 2026-11-25:
JPMorgan Chase listed seven sites, Oracle's own tenant six, so the first page
covered each. The list includes backups, alumni and retired sites (for example
"Baseline DO NOT UPDATE"), so it is not a safe way to pick a board. Read the site
number from the employer's careers URL instead. The CLI intentionally does not
expose a `sites` command for that reason.

## Endpoints

### Search

```
GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions
    ?onlyData=true
    &expand=requisitionList.workLocation,requisitionList.secondaryLocations
    &finder=findReqs;siteNumber=<site>,facetsList=<facets>,limit=20,sortBy=POSTING_DATES_DESC,offset=<offset>[,locationId=<id>][,postingStartDate=<date>][,keyword=<query>]
    &limit=20
    &offset=<offset>
```

- `onlyData=true` omits extra REST metadata and links; the response keeps the
  `items[]` collection shown below.
- `expand` is **required** in practice: without it some tenants return
  `TotalJobsCount` but an empty or missing `requisitionList`.
- Paging params are set in **both** the `finder` segment and the top level;
  some tenants honour only one.
- `finder` grammar: `findReqs;` then comma-separated `key=value` pairs. The
  `facetsList` value itself uses `;` as its separator:
  `LOCATIONS;WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS`.
- `keyword` is the board's own keyword search. **Commas, semicolons and
  control characters cannot be carried inside it** — commas and semicolons are
  the finder's separators, and control characters break the request — so the
  CLI rejects them instead of silently changing the query.
- `locationId` is an optional numeric scope. Most tenants ignore it or do not
  need it, but the upstream provider notes BNY Mellon and American Express
  return an unscoped set without one. On 2026-11-25, adding
  `locationId=300000020694566` to the JPMorgan Chase board changed
  `TotalJobsCount` from 6,801 to 844 and returned New York roles.
- `postingStartDate=YYYY-MM-DD` is a documented finder variable and scopes by
  posting date. On 2026-11-25 it changed JPMorgan Chase from 6,799 to 895 for
  `2026-11-20` and to 425 for `2026-11-24`; Oracle's own tenant went from 2,873
  to 265 / 128. The CLI sends it for `--jobage`.
- The docs also list a free-text `location` finder variable. It did **not**
  scope results on the JPMorgan Chase board (same 6,799 for `New York` and
  `London`), so the CLI keeps `--location` client-side and exposes
  `--location-id` for numeric scoping.
- `workplaceType`/`selectedWorkplaceTypesFacet` accept `ORA_REMOTE`,
  `ORA_HYBRID` and `ORA_ON_SITE` per the provider notes, but the tested
  JPMorgan Chase board returned 0 for the first two and the whole board for
  `ORA_ON_SITE`, so the CLI does not expose a workplace filter.
- The CLI uses a fixed page size of 20 and `sortBy=POSTING_DATES_DESC`.

Response (abridged, verified live against JPMorgan Chase on 2026-11-25):

```json
{
  "items": [
    {
      "SearchId": 1,
      "Offset": 0,
      "Limit": 20,
      "TotalJobsCount": 6801,
      "SiteNumber": "CX_1001",
      "requisitionList": [
        {
          "Id": "210675973",
          "Title": "Corporate - Dining Waitstaff",
          "PostedDate": "2026-11-25",
          "PrimaryLocation": "New York, NY, United States",
          "PrimaryLocationCountry": "US",
          "WorkplaceTypeCode": null,
          "ShortDescriptionStr": "Come join our dining waitstaff ...",
          "secondaryLocations": [],
          "workLocation": [
            {
              "LocationId": 300000161126808,
              "TownOrCity": null,
              "Region": null,
              "Country": null
            }
          ]
        }
      ]
    }
  ]
}
```

Field notes:

- `items[0].requisitionList[]` holds the postings; `items[0].TotalJobsCount` is
  the board's count for the query.
- `Id` is the requisition's ORC id (also the tail of the public `/job/<id>`
  URL). The detail resource is keyed by this `Id`, so the CLI uses only `Id`;
  rows without one are dropped. `RequisitionNumber` is a different identifier
  and is not used as the posting URL or detail key.
- `PostedDate` is a plain `YYYY-MM-DD` date.
- `PrimaryLocation` is a display string. `secondaryLocations[].Name` lists the
  other places the requisition is open in.
- `workLocation[]` is an address object; its `TownOrCity`/`Region`/`Country`
  parts are often null even when `PrimaryLocation` is set.
- `WorkplaceTypeCode` can be `ORA_REMOTE` or `ORA_HYBRID`; the CLI appends
  `Remote` / `Hybrid` to the location string.
- `ExternalURL` is sometimes present. The CLI **ignores** it and rebuilds the
  posting URL from the parsed board plus `Id`, so third-party payload data
  cannot choose where `detail` points.
- `hasMore` is unreliable on some tenants (it can be `false` on every page of a
  7,000-posting board), so it is not used.

### Detail

```
GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails/<id>
    ?onlyData=true
    &expand=workLocation,secondaryLocations
```

The id is the one from search, not the numeric `RequisitionId` field. The docs
also expose the finder form `finder=ById;Id="<id>",siteNumber=<site>`. It
answers 200 with an empty `items` array for a missing id, while the direct path
above answers 404 (verified on JPMorgan Chase). The CLI uses the direct path, so
a missing or closed posting maps to `NOT_FOUND` rather than an empty parse
result.

Response (abridged, verified live against JPMorgan Chase on 2026-11-25):

```json
{
  "Id": "210812363",
  "Title": "Lead Software Engineer",
  "PrimaryLocation": "Palo Alto, CA, United States",
  "secondaryLocations": [
    { "Name": "New York, NY, United States", "CountryCode": "US" },
    { "Name": "Jersey City, NJ, United States", "CountryCode": "US" }
  ],
  "WorkplaceTypeCode": null,
  "ExternalPostedStartDate": "2026-11-25T10:00:00+00:00",
  "ExternalPostedEndDate": null,
  "JobSchedule": "Full time",
  "JobType": null,
  "LegalEmployer": null,
  "Organization": null,
  "ExternalDescriptionStr": "<p>...</p>",
  "ExternalResponsibilitiesStr": null,
  "ExternalQualificationsStr": null,
  "ShortDescriptionStr": "..."
}
```

Field notes:

- `ExternalPostedStartDate` is an ISO timestamp; the CLI reduces it to
  `YYYY-MM-DD`.
- `ExternalPostedEndDate` is the application deadline when the tenant sets one.
- `JobSchedule` (e.g. `"Full time"`) is the employment type; `JobType` is a
  fallback.
- `LegalEmployer` and `Organization` are sometimes null; the CLI falls back to
  the host's tenant slug.
- Some tenants put the whole ad in `ExternalDescriptionStr` and leave
  `ExternalResponsibilitiesStr` / `ExternalQualificationsStr` empty (JPMorgan
  Chase does). Others use all three; the CLI renders `ExternalDescriptionStr`
  as the unlabelled body and the other two as labelled `Responsibilities` and
  `Qualifications` sections. If all three are empty it falls back to
  `ShortDescriptionStr`.
- A missing or closed requisition answers `404`.
- `expand=workLocation,secondaryLocations` is used so `secondaryLocations` is
  populated on tenants that expose it.

## Quirks and access notes

- **Site numbers are not validated by the API.** A site number the tenant does
  not define can fall back to its default site and return that board's jobs
  instead of an error (observed against JPMorgan Chase). Read the site number
  from the careers URL; do not guess.
- **Keyword semantics are relevance-ranked, not boolean.** On 2026-11-25,
  `software` returned 1,492, `engineer` 2,005, `software engineer` 1,500 and
  `engineer software` 1,331 — so word order changes the set. Quote characters
  are ignored (`"software` matched the same as `software`; `"software engineer"`
  matched the same as the bare phrase), and `AND` / `OR` / `NOT` are passed as
  ordinary terms. One plain term per call is the predictable form.
- **WAFs.** Some tenants front the API with Imperva or a similar WAF that
  answers `403`, `503` or `504` to non-browser clients or cloud egress IPs.
  The same request can succeed from a residential connection; this is an
  environment/IP issue, not a parser bug. The CLI sends an honest User-Agent
  (`Mozilla/5.0 (compatible; oraclecloud-cli/1.0; ...)`) and does not escalate
  to browser impersonation.
- **robots.txt** is served per tenant. Some hosts answer `403` to it (the WAF),
  so it could not be verified across the family. The CLI stays on the
  `/hcmRestApi/` JSON endpoints the careers site itself calls and never fetches
  careers pages.
- **Branded hosts** are out of scope (`enterpriseplatform.dell.com` and similar
  CDN-fronted employer domains), because the host pin enumerates only Oracle's
  pod family. Adding one would require its own explicit allowlist entry, not a
  wildcard.
- Both endpoints are public and unauthenticated. No token, cookie or API key is
  sent.
