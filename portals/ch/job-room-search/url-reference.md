# job-room.ch API Reference

Public, unauthenticated JSON REST API used by the official Swiss job platform
**job-room.ch**, operated by SECO (Staatssekretariat für Wirtschaft / Secrétariat
d'État à l'économie) — the federal Public Employment Service ("service public de
l'emploi", ORP/RAV in French/German-speaking Switzerland).

`robots.txt` disallows crawling `/job-search/` (the human-facing search UI) but says
nothing about the underlying `jobadservice` API used here, which is a distinct
`www.job-room.ch/jobadservice/...` path serving JSON directly.

## Search

```
POST https://www.job-room.ch/jobadservice/api/jobAdvertisements/_search?page=0&size=20&sort=date_desc
Content-Type: application/json
```

Query params:

| Param | Meaning | Verified values |
|---|---|---|
| `page` | 0-indexed page number | `0`, `1`, … |
| `size` | Results per page | any int, e.g. `20` |
| `sort` | Sort order | `date_desc` (200), `date_asc` (200). `relevance` → **400** (not supported). |

Body — `JobAdvertisementSearchRequest` DTO. Fields confirmed live by probing (an
unrecognized field returns HTTP 400 with `Unrecognized field "<name>"
(class ...JobAdvertisementSearchRequest)`, which is how these were discovered):

| Field | Type | Notes |
|---|---|---|
| `keywords` | `string[]` | Free-text query terms, e.g. `["data engineer"]`. Matches highlight with `<em>` tags in the response (strip them). |
| `cantonCodes` | `string[]` | Two-letter canton codes, e.g. `["GE","VD"]`. |
| `communalCodes` | `string[]` | Swiss commune (BFS) codes — accepted, not probed further. |
| `workloadPercentageMin` | `int` | Accepted; default appears to be `10` if omitted. |
| `workloadPercentageMax` | `int` | Accepted; default appears to be `100` if omitted. |
| `permanent` | `boolean` | Accepted (permanent vs. fixed-term contract filter). |
| `companyName` | `string` | Accepted. |
| `displayRestricted` | `boolean` | Accepted, semantics not fully probed. |
| `onlineSince` | `int` | Accepted — **integer days**, not a date string (`"TODAY"` → 400 type error: expects `java.lang.Integer`). |

Fields tried and **rejected** (not on the DTO, or wrong shape):
- `professionCodes` — field exists conceptually but expects a structured `ProfessionCode`
  object, not a bare string (`"101350"` → deserialize error). Not worth using without
  the exact shape; filter by `keywords` instead.
- `regionCodes`, `workExperience`, `contractType` — **not recognized fields** (400).

Response: `200` with a JSON **array** (not wrapped in an envelope) of:

```json
{
  "jobAdvertisement": {
    "id": "<uuid>",
    "createdTime": "2026-08-01T02:07:31.91",
    "status": "PUBLISHED_PUBLIC",
    "sourceSystem": "EXTERN",
    "jobContent": {
      "externalUrl": "https://www.jobup.ch/...",
      "jobDescriptions": [
        { "languageIsoCode": "de", "title": "Software <em>Engineer</em> ...", "description": "..." }
      ],
      "company": { "name": "...", "street": null, "city": null, ... },
      "employment": {
        "permanent": true,
        "workloadPercentageMin": "100",
        "workloadPercentageMax": "100",
        "startDate": null, "endDate": null, "workForms": []
      },
      "location": {
        "city": "Genève Carouge",
        "postalCode": "1227",
        "communalCode": "6608",
        "regionCode": "GE01",
        "cantonCode": "GE",
        "countryIsoCode": "CH",
        "coordinates": { "lon": "6.14", "lat": "46.185" }
      }
    },
    "publication": { "startDate": "2026-07-30", "endDate": "2026-09-28", ... }
  },
  "favouriteItem": null
}
```

Key field paths used by the CLI:
- Title/description (per language): `jobAdvertisement.jobContent.jobDescriptions[].{languageIsoCode,title,description}`
  — a listing may have **multiple language variants**; the CLI picks fr → de → en → it, first match.
- Company: `jobAdvertisement.jobContent.company.name`
- Location: `jobAdvertisement.jobContent.location.{city,postalCode,cantonCode,communalCode,regionCode}`
- Workload: `jobAdvertisement.jobContent.employment.{workloadPercentageMin,workloadPercentageMax,permanent}`
- Publication window: `jobAdvertisement.publication.{startDate,endDate}`
- Posted date proxy: `jobAdvertisement.createdTime` (no separate "online since" field on the search hit — `createdTime` is what the CLI reports as `onlineSince`, truncated to the date).
- Original source: `jobAdvertisement.jobContent.externalUrl`

`<em>...</em>` highlight tags wrap keyword matches inside `title`/`description` —
strip them. Some free-text fields (titles, company names) are also HTML-entity-encoded
(e.g. `&amp;` for `&`) — decode entities after stripping `<em>` tags.

### Result count

The `X-Total-Count` response header carries the total match count (confirmed live,
e.g. `x-total-count: 55`). A `Link` header with `rel="next"`/`rel="last"`/`rel="first"`
is also present (RFC 5988 style), giving direct next-page URLs.

## Detail

```
GET https://www.job-room.ch/jobadservice/api/jobAdvertisements/<id>
```

Verified live — returns **HTTP 200** with the raw `jobAdvertisement` object directly
(not wrapped in `{jobAdvertisement: {...}}` like the search hit envelope; the fields
are otherwise identical). `<id>` is a UUID, e.g. `e75c4b4a-ff96-477c-908b-91fd6416fdfc`
(not numeric like LinkedIn job IDs). A non-existent/invalid id returns 404.

## Quirks / notes

- **No authentication required** for either endpoint.
- Sort only supports `date_desc` / `date_asc` — `relevance` is rejected (400). If you
  want relevance ordering, omit `sort` from ranking logic client-side or just use
  `keywords` matching order as returned.
- **Syndication / dedup**: a large share of postings are external listings mirrored
  from other Swiss job boards (most commonly **jobup.ch**, also seen: direct employer
  career pages) via `jobContent.externalUrl`. `sourceSystem: "EXTERN"` marks these.
  The **same role** may be independently listed on job-room.ch *and* discoverable via
  a search of the origin site — if aggregating job-room results with other sources,
  dedupe on `(title, company.name)` or the `externalUrl` domain, not just job-room's
  internal `id`.
- Multi-language: job-room serves French/German/Italian/English descriptions for the
  same posting when the employer supplied them; `jobDescriptions[]` can have more than
  one entry. Titles observed defaulting to German (`languageIsoCode: "de"`) even for a
  clearly French-market Geneva/Vaud role — don't assume language from canton.
- Response headers also send `Content-Security-Policy`-style hardening headers and a
  session cookie (`set-cookie`); not required for stateless GET/POST use.
