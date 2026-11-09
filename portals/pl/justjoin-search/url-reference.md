# justjoin.it — endpoint and parsing reference

Everything this skill depends on about justjoin.it's public pages. If the CLI
starts returning empty or garbled results, this is the file to re-verify first.

Verified live: **2026-08-31**.

## Access rules (robots.txt)

| Host / path | Rule | This skill |
|-------------|------|------------|
| `justjoin.it/job-offers/…` | no `Disallow` | **used** (search) |
| `justjoin.it/job-offer/<slug>` | no `Disallow` | **used** (detail) |
| `justjoin.it/api/` | `Disallow` | never called |
| `justjoin.it/oferty-pracy/*,*` | `Disallow` (comma-filtered variants) | never called |
| `api.justjoin.it/*` | `Disallow: /` for `User-agent: *` | **never called** |

The JSON API on `api.justjoin.it` would be the obvious data source and is
deliberately off limits. That single decision is why pagination is unsupported:
page 2 onward is only reachable through that host.

User-Agent sent: `Mozilla/5.0 (compatible; justjoin-search-cli/1.0)` — honest,
names the tool, no browser impersonation.

## Search

```
https://justjoin.it/job-offers/<location-slug>[/<category-slug>]?<params>
```

| Segment / param | Values | Notes |
|-----------------|--------|-------|
| `<location-slug>` | `all-locations`, `warszawa`, `krakow`, `wroclaw`, `gdansk`, `poznan`, … | Diacritics stripped, spaces hyphenated (`Zielona Góra` → `zielona-gora`) |
| `<category-slug>` | `php`, `python`, `javascript`, `java`, `net`, `devops`, `testing`, `data`, `architecture`, `mobile`, … | Optional second path segment |
| `keyword` | free text | The search box; matches title, company and skills |
| `workplace` | `remote` \| `hybrid` \| `office` | The site 307-redirects the legacy `remote=yes` to `workplace=remote`, which is how the canonical name was confirmed |
| `experience-level` | `junior` \| `mid` \| `senior` \| `c-level` | |
| `employment-type` | `b2b` \| `permanent` \| `mandate` \| `internship` | |
| `with-salary` | `yes` | Only offers disclosing a band |
| `orderBy` / `sortBy` | `DESC` / `published` | Always sent; newest first |
| `page` | — | **Not honoured by the server-rendered page.** `?page=2` returns byte-identical results to page 1; real pagination lives on `api.justjoin.it` |

No posting-age parameter exists. `--jobage` is applied client-side against each
offer's `publishedAt`.

## Response structure (search)

justjoin is a **Next.js App Router** app. The results are not in the HTML cards —
those use build-hashed MUI class names (`mui-1pc4jlc`) that change on every
deploy and must **not** be parsed. The data arrives instead as a streamed React
Server Component payload:

```html
<script>self.__next_f.push([1,"<json-string-chunk>"])</script>
```

Parsing pipeline (`helpers.ts`):

1. `extractRscPayload` — match every `self.__next_f.push([1,"…"])`, `JSON.parse`
   each chunk (they are JSON string literals, so this un-escapes them correctly),
   and concatenate. A chunk that fails to parse is skipped.
2. `parseOffers` — scan the payload for the literal `{"applyUrl":`, find each
   object's closing brace with `matchBraces` (string- and escape-aware), and
   `JSON.parse` each offer independently. One malformed offer cannot break the rest.
3. `normalizeOffer` — map onto the portal-skill contract.

A typical search page yields **50–100 offer objects**.

### Offer object fields used

| Field | Maps to | Notes |
|-------|---------|-------|
| `slug` | `id`, and `url` = `https://justjoin.it/job-offer/<slug>` | |
| `title` (fallback `body`) | `title` | On search pages `body` is the title; on detail pages it is a reference to the description chunk |
| `companyName` | `company` | |
| `city` | `location` | |
| `publishedAt` | `date` (ISO date, truncated to `YYYY-MM-DD`) | |
| `expiredAt` | `deadline` | |
| `workplaceType` | `workplaceType` | `remote` / `hybrid` / `office` |
| `experienceLevel` | `experienceLevel` | |
| `employmentTypes[]` | `salary`, `employmentType` | Pick the entry with `currencySource == "original"`; the rest are FX conversions |
| `requiredSkills[]` | `skills` | |
| `multilocation[]` | `otherLocations` | Same job posted per city, each with its own slug |

## Detail

```
https://justjoin.it/job-offer/<slug>
```

Two independent sources on the page, merged:

1. **`<script type="application/ld+json">`** with `"@type": "JobPosting"` —
   `title`, `datePosted`, `validThrough` (the deadline), `employmentType`,
   `hiringOrganization.name`, `jobLocation.address` (locality, street, country),
   `baseSalary` (currency + min/max + `unitText`), `jobLocationType`
   (`TELECOMMUTE` for remote), and `description`.
   ⚠️ The JSON-LD `description` is the offer text with **all paragraph and list
   breaks already stripped** — sentences run together. Do not use it when the
   streamed body is available.
2. **The RSC payload**, which carries what JSON-LD omits.

### Detail-page shape differences (they bite)

The detail page's offer object is **not** shaped like a search result:

- It is wrapped as `{"offer":{…}}`, and does not lead with `applyUrl`, so
  `parseOffers`' marker never matches it. `parseDetailOffer` anchors on
  `"offer":{` and confirms the object by its `slug`.
- Enum fields are `{ label, value }` objects, not strings:
  `"workplaceType": {"label":"remote","value":"remote"}`. `labelValue()` accepts
  both shapes.
- `requiredSkills` is `[{ id, name, level }]`, not `["PHP"]`. `skillNames()`
  accepts both.
- `body` is a **reference** to a separately-streamed text chunk, e.g. `"$5b"`,
  resolved by `resolveRscRef` against:

  ```
  \n5b:T<hex-length>,<raw HTML description>
  ```

  The hex length is the character count to slice. This chunk holds the real
  `<p>`/`<ul>`/`<li>` markup, which `stripHtml` turns back into paragraphs and
  `- ` bullets.
- `isOfferActive` (boolean) is authoritative for `isActive`; `validThrough` is
  the fallback.

## Failure modes to expect

| Symptom | Likely cause |
|---------|--------------|
| `PARSE_FAILED` on search | `self.__next_f` streaming replaced, or offer objects no longer lead with `applyUrl` |
| Results present but `company`/`city` null | Offer object field names renamed |
| Description runs sentences together | `resolveRscRef` failed and the code fell back to JSON-LD — check the `<ref>:T<hex>,` chunk format |
| `seniority`/`skills` empty on `detail` only | The `{"offer":{…}}` envelope changed — re-check `parseDetailOffer` |
| Empty results with HTTP 200 | Query returned nothing, or a filter value left a controlled vocabulary (`workplace`, `experience-level`, `employment-type`) |
