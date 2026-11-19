# nofluffjobs.com — endpoint and parsing reference

Everything this skill depends on about No Fluff Jobs' public pages. If the CLI
starts returning empty or garbled results, this is the file to re-verify first.

Verified live: **2026-08-31**.

## Access rules (robots.txt)

| Path | Rule | This skill |
|------|------|------------|
| `/` | `Allow` | — |
| `/pl?criteria=…` | no `Disallow` | **used** (search) |
| `/job/<slug>` | no `Disallow` | **used** (detail) |
| `/api/` | `Disallow` | never called |
| `/posting/`, `/pl/posting/`, `/hu|ua|cz|sk|nl/posting/` | `Disallow` | never called |
| `*/job/job/*`, `/pdf/`, `/not-found*`, `/signal` | `Disallow` | never called |

The site is Angular with **server-side rendering**, so the public pages return the
full result list as HTML and the disallowed JSON API is not needed.

User-Agent sent: `Mozilla/5.0 (compatible; nofluffjobs-search-cli/1.0)` — honest,
names the tool, no browser impersonation.

## Search

```
https://nofluffjobs.com/pl?criteria=<packed filters>&sort=newest&page=<n>
```

Filters are **one packed `criteria` string**, space-separated `key=value` pairs,
percent-encoded (`%20` between terms, `%3D` for `=`):

| Term | Values | Notes |
|------|--------|-------|
| `keyword` | free text | Title, company and skill match |
| `city` | `warszawa`, `krakow`, `wroclaw`, `remote`, … | Diacritics stripped; `remote` is a city value, not a separate flag |
| `category` | `backend`, `frontend`, `fullstack`, `devops`, `testing`, `data`, `mobile`, … | |
| `seniority` | `trainee`, `junior`, `mid`, `senior`, `expert` | |

Example (verified): `/pl?criteria=keyword%3Dsymfony%20city%3Dremote%20seniority%3Dsenior`

**`sort=newest` is always sent** (verified 2026-11-04). The default order is
relevance, which mixes fresh postings in with old ones, so a new offer can fall
below the `--limit` cut-off. With `sort=newest` the server-rendered list is ordered
by latest activity - the later of a posting's `posted` and `renewed` timestamps -
so employer-renewed ("bumped") old offers sort alongside genuinely new ones. The CLI
hard-codes it; there is no flag to turn it off.

**Pagination is cumulative.** `?page=N` returns pages 1..N in a single response:
20 unique offers at page 1, 40 at page 2, 60 at page 3. Promoted cards repeat, so
raw card counts exceed unique slugs — de-duplication by slug is required, not
cosmetic.

`?page=0` and negative values are rejected by the CLI before any request.

**There is no posting-age parameter, and listing cards carry no date** - but the page
does. Its embedded Angular state (`<script id="serverApp-state" type="application/json">`)
holds the search result as `{ totalCount, totalPages, postings: [...] }` under a hashed
key; each posting has `url` (the slug), `posted` (ms epoch; same day as the detail
page's `datePosted`) and, when bumped, `renewed`. `listingDates()` reads `posted` and
`totalCount` from that top-level result only - never from its nested
`additionalSearch` filler. `--jobage` filters on those dates client-side; only results
the state leaves undated fall back to a detail-page request (at most 30). Verified
2026-11-04. `--all` requests `?page=10` (offers 1..200) once, and compares the count
read against `totalCount` to report truncation.

## Response structure (search)

**Only the first list(s) are matches.** A query with few matches gets a second
block appended below them: `<nfj-postings-list listname="search_extended">` under
the heading "Mogą Cię też zainteresować" - offers that do **not** match the query,
in no date order (verified 2026-11-04: `php` + `remote` had 18 matches and 22
filler cards on `?page=2`). The real lists carry `listname="search"`.
`mainListing()` cuts the page at the `search_extended` list before card parsing;
if the portal renames that attribute, filler will leak back into results.

Cards are Angular components anchored by **`data-cy` test attributes** and
semantic tag names — deliberately parsed instead of the Tailwind/`_ngcontent`
class names, which change on every build.

Parsing pipeline (`helpers.ts`):

1. `splitCards` — split the page on `nfj-postings-item` and keep the chunks that
   contain an `href="/job/…"`. One malformed card cannot break the rest.
2. `parseCard` — per-chunk field extraction.
3. `parseCards` — de-duplicate by slug.

| Field | Anchor | Notes |
|-------|--------|-------|
| `id` | `href="/job/([^"]+)"` | The canonical slug. The `id="nfjPostingListItem-…"` variant differs in case and city suffix — do not use it |
| `title` | `data-cy="title position on the job offer listing"` | Text follows the tag directly; a trailing `<span>NEW</span>` badge is excluded |
| `company` | `<h4 class="company-name …">` | ⚠️ Contains a leading `<inline-icon>` SVG, so the whole element's inner HTML must be stripped (`innerText`), not the characters after the tag |
| `location` | `<nfj-posting-item-city data-cy="location on the job offer listing">` | Same `<inline-icon>` caveat. A trailing `+N` means N further cities → `extraLocations` |
| `salary` | `<nfj-posting-item-salary>` … `</nfj-posting-item-salary>` | See "Salary formats" |
| `tags` | every `data-cy="category name on the job offer listing"` | Category plus tech stack |
| `date` | — | **Not present on cards** |

## Salary formats

All observed live and covered by tests:

| Text | Parsed |
|------|--------|
| `900 – 1 100 PLN / day` | `{from: 900, to: 1100, currency: PLN, unit: day}` |
| `80 – 130 PLN / h` | `unit: hour` |
| `18 000 PLN / mth` | `unit: month` |
| `80 – 130 PLN + VAT (B2B) per hour` (detail page) | adds `type: "b2b"`; note `per hour`, not `/ h` |
| `1.5M – 2.5M HUF / month` | `{from: 1500000, to: 2500000}` |

⚠️ The abbreviation case is the dangerous one: reading `1.5M` as `1` understates a
salary by six orders of magnitude. `parseAmount` treats a dot or comma next to a
`K`/`M` suffix as a decimal point and otherwise as a thousands separator
(`18.000` → 18000).

Thousands separators are non-breaking spaces (`&nbsp;`, U+00A0) and the range dash
is an en dash (U+2013, sometimes `&ndash;`) — both are decoded before parsing.

## Detail

```
https://nofluffjobs.com/job/<slug>
```

Three sources on the page:

1. **`<script type="application/ld+json">`** — a `@graph` array; the `JobPosting`
   entry holds `title`, **`datePosted`**, `employmentType`, `hiringOrganization.name`,
   `jobLocation.address`, and a `baseSalary` that often reports only the **upper**
   bound. Its `description` is also truncated, so it is a fallback, not the source.
2. **Section divs**, addressed by stable ids:
   `posting-header`, `posting-requirements`, `posting-tasks`, `posting-description`,
   `posting-specs`, `posting-benefits`, `posting-company`, `posting-seniority`.
   ⚠️ These ids sit on plain `<div>`s, **not** `<section>`s, and the sections are
   siblings — `sectionText` runs from the end of a div's opening tag to the tag
   carrying the next `id="posting-…"`.
3. **`<common-posting-salaries-list>`** — the posting's own salary widget(s),
   carrying the full range and the contract type.

`posting-requirements` is where language requirements live, as explicit list
entries: `Must have / - PHP / - Symfony / - Polish (Fluent) / - English (C1)`.

The deadline is prose in the header: `Offer valid until: 06.09.2026 (7 days left)`
(Polish: `Oferta ważna do:`), parsed to an ISO date by `parseDeadline`.

### The similar-offers trap

Every `<nfj-posting-item-salary>` widget on a detail page belongs to the
**"similar offers"** list appended below the posting — the posting's own rate is in
`<common-posting-salaries-list>` instead. Parsing the whole document therefore
reports *other companies'* pay as this posting's. `mainRegion()` slices from
`id="posting-header"` to `<nfj-posting-similar` and every detail parser works
inside that slice.

## Failure modes to expect

| Symptom | Likely cause |
|---------|--------------|
| `PARSE_FAILED` on search | `nfj-postings-item` renamed, or SSR disabled (page arrives as an empty Angular shell) |
| Titles present but `company`/`location` null | The `company-name` class or `nfj-posting-item-city` tag changed — check the `innerText` anchors |
| Salaries wildly too small | `parseAmount` regressed on the `K`/`M` abbreviation |
| A posting's salary matches a different company's | `mainRegion` boundary broke; `<nfj-posting-similar>` renamed |
| `requirements` text contains `id=` or `_ngcontent` | `sectionText` boundary broke — the section ids moved onto different elements |
| `date` null everywhere | Expected without `--dates`/`--jobage`; with them, check `datePosted` in the detail JSON-LD |
