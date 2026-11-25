# publicjobs-search URL Reference

Public endpoints used by this skill, recorded on 2026-11-25 from live responses. These are
the anchors to update when the site changes. `robots.txt` was checked with
`tools/robots_check.py` on both URL patterns below, and both were ALLOWED. The site's
`robots.txt` disallows only `/admin/*`, `/kandidaten/*`, `/print/*`, `/pdf/*`, their French
equivalents, `/*~applyID`, and a list of named bots.

Terms: the AGB of Swiss Public Services AG (`https://publicjobs.ch/ueber-uns/agbs`, read
2026-11-25) regulate advertisers' and job seekers' use of the platform. They have no clause on
automated access, crawling, or reuse of posting content.

The site is a SvelteKit app (front end) on a "DPGjom" job backend. Each page has a JSON twin at
`<path>/__data.json`, encoded with [devalue](https://github.com/Rich-Harris/devalue).

## Search: sitemap

```
GET https://publicjobs.ch/sitemap.xml
```

About 1.1 MB, 2,600 `<url>` entries, of which about 1,800 are job postings. A job entry:

```xml
<url>
  <loc>https://publicjobs.ch/jobs/<region>/<category>/<id>-<title-slug></loc>
  <lastmod>2026-11-25T10:05:07.287474Z</lastmod>
  ...
  <xhtml:link rel="alternate" hreflang="de-CH" href="..." />
</url>
```

| Part | Use |
|------|-----|
| `<region>` | canton slug: `zuerich`, `st-gallen`, `basel-landschaft`, `schweiz` (nationwide), ... Mapped to name and code in `REGIONS` (`helpers.ts`) |
| `<category>` | category slug: mapped to the site's label in `CATEGORIES` |
| `<id>` | `dynPgID`, the posting's public id. It increases as postings are created and is used to sort newest first |
| `<title-slug>` | lowercase title with umlauts spelled out, **truncated at 150 characters** |
| `<lastmod>` | **not a posting date.** On 2026-11-25, 1,040 of 1,805 entries carried 2026-11-23 and 612 carried 2026-11-25. It's a batch refresh stamp and isn't used |

Entries under `/fr/jobs/...` are French alternates of the same postings and are skipped.
Blog, organisation and landing pages are skipped by the path pattern
`^/jobs/<region>/<category>/<digits>-<slug>$`.

Canton labels and codes come from the site's own footer region list
(`footerSitemapCategories.region` in `/jobs/__data.json`). The sitemap uses
`basel-landschaft` while the footer uses `baselland`, so both are mapped.

Category labels (`categoryList` in `/jobs/__data.json`): Architektur / Bauwesen ·
Bildungswesen / Lehrtätigkeit / Sonderpädagogik · Diverse · Energie / Ingenieurwesen /
Verkehr · Finanzen / Steuern · Gastronomie / Hauswirtschaft / Hotellerie · Informatik / IT ·
Kaufmännisch / Verwaltung · Kinderkrippe / Kinderbetreuung · Kirchwesen / Seelsorge ·
Logistik / Einkauf · Marketing / Kommunikation / PR · Medizin / Ärzte / Pflege · NGO / NPO /
Stiftungen · Öffentliche Sicherheit / Militär / Polizei · Personalwesen / HR ·
Projektmanagement / Qualitätsmanagement · Recht / Justiz / Justizvollzug · Sozialwesen /
Sozialarbeit · Stabsdienste / Führungsunterstützung · Unterhalt / Handwerk / Aussenstellen.

## Detail: `__data.json`

```
GET https://publicjobs.ch/jobs/<region>/<category>/<id>-<slug>/__data.json?x-sveltekit-invalidated=01
GET https://publicjobs.ch/jobs/x/x/<id>/__data.json?x-sveltekit-invalidated=01   (id only)
```

`x-sveltekit-invalidated=01` asks for the page node only and skips the layout node (menus,
footer), which brings the response from about 250 KB to about 200 KB.

The id-only form returns `{"type":"redirect","location":"/jobs/<canonical path>"}`. The CLI
follows exactly one redirect, and only to a path matching the job pattern.

A normal response is `{"type":"data","nodes":[{"type":"skip"},{"type":"data","data":[...]}]}`.
Decode `data` with devalue (`unflatten` in `helpers.ts`), then read the `job` object:

| Field | Use |
|-------|-----|
| `dynPgID` | `id` |
| `title` | `title` |
| `contactCompany` | `company` |
| `contactCategory` | `organisationType` (Bund und Kantone, Gemeinden und Städte, Schulen, Spitäler und Kliniken, ...) |
| `workingAddressCity`, `workingAddressRegion` | `location` ("Schwyz (SZ)"), `canton` |
| `jobCategory`, `careerLevel` | `category`, `careerLevel` |
| `workloadFrom`, `workloadTo` | `workload`; can disagree with the title |
| `publicFrom` | `date` (publication, possibly a re-publication) |
| `createdAt` | `created` |
| `publicTo` | `listingEnd` (ad goes offline; not the application deadline) |
| `contactFirstName`, `contactLastName` | `contactName` |
| `lead` | `lead` |
| `descriptionSimpleHtml`, else `description` | `description` (HTML to text) |
| `applicationLink`, else `redirectUrl` | `applyUrl` (often an ATS redirect, e.g. ohws.prospective.ch) |
| `pathDe` | `url` (`https://publicjobs.ch/jobs` + `pathDe`) |

Also present but not output: `contactEmail`, `contactTelephone`, social links,
`templateHtml` (~130 KB of the employer's styled page), `benefits`, coordinates. Dates use
Go's zero time `0001-01-01T00:00:00Z` for "unset", which the CLI maps to null.

An expired or removed posting answers 200 with a node of type `error`:
`{"type":"error","error":{"message":"Diese Stelle ist nicht mehr verfügbar","kind":"job-expired",...}}`.
The CLI reports that as `NOT_FOUND`.

## Not used

- **Keyword search**: `POST /jobs?/jobSearch` (SvelteKit form action, header
  `x-sveltekit-action: true`, body field `__superform_json` = devalue-encoded
  `{search, city, radius, workload, actuality, jobCategory, careerLevel, contactCategory, benefits, limit, offset}`).
  This would give server-side keyword search, paging and full records. It wasn't adopted
  because this skill sticks to GET requests.
- **GET filters**: `/jobs/__data.json?city=Luzern` or `?category=informatik-it` (also
  `subCategory`, `level`, `contract`, `organization`, `benefits`, `workloadFrom`,
  `workloadTo`) filter server-side but always return the first 24 rows, without paging
  (`limit`, `offset` and `page` are ignored on GET). `search`, `q`, `query`, `term` and
  `keyword` are ignored too.
