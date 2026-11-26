# Editx.eu data source reference

Editx.eu is a Belgian IT job board. Its job pages are a JavaScript single-page
app: `https://editx.eu/en/it-jobs/` returns an empty HTML shell, and the browser
loads jobs from `https://api.editx.eu`. This CLI calls the same two endpoints.
They are **undocumented**; everything below was observed on 2026-11-25 with the
User-Agent `Mozilla/5.0 (compatible; editx-search-cli/1.0)` (no browser
headers, no cookies, no token; the site itself sends an empty `Authorization`
header for anonymous visitors).

## Search

`GET https://api.editx.eu/api/editx/jobs?keyword=<text>[&location=<place>][&page=<n>][&count=<n>]`

| Param | Meaning |
|---|---|
| `keyword` | Free text. Matches postings containing any of the words; quotes, word order and `OR` have no operator effect. An empty keyword returns the whole board. |
| `location` | Free text matched against the posting's locality and areas, e.g. `Gent`, `Antwerpen`, `Leuven`, `Brussels`. `Ghent` returns nothing. |
| `page` | **0-based**. Omitted = 0. The CLI's `--page 1` sends no `page`, `--page 2` sends `page=1`. |
| `count` | Page size, default 50, capped at 50 server-side (`count=200` returns 50). The CLI always sends `count=50` so a page is a fixed block, and applies `--limit` client-side. |

Not supported (sent and ignored): `sort`, any date filter. The site's filter UI
also exposes `country`, `experiences`, `job_location_type`, `functions`,
`contracts`, `educations` and `etags` vocabularies; this CLI does not use them.

Response:

```json
{ "total": 10, "page": 0, "count": 50, "jobs": [ { ... } ] }
```

- `page` and `count` come back as numbers by default and as strings when sent.
- Past the last page: `{ "total": 0, "page": "9", "count": 50, "jobs": null }`.
  The CLI reports that as an empty page with `total: null`.

Job fields read (search): `id`, `title`, `onlineDate.value`
(`"2026-11-17 08:10:22"`, UTC), `locality`, `areas[].label`, `company.label`,
`contracts[].label`, `remote.label`, `skills[].label`.

Each job also carries a `recruiter` object (a named person: first name,
abbreviated last name, photo URLs, LinkedIn URL). **The CLI never reads it**,
and the test fixtures have it removed.

## Detail

`GET https://api.editx.eu/api/editx/job/<id>`

- 200: the search fields plus `openToApply`, `applicationType` (`"url"` seen),
  `applicationAction` (the external apply URL when the type is `url`, carrying
  `utm_source`/`utm_medium`/`utm_campaign`, which the CLI strips),
  `languages` (codes, e.g. `["en"]`), `shortDescription` (plain text), `role`,
  `profile`, `proposal` (HTML sections), `functions`, `experiences`,
  `educations` (`[{id,label}]`), and `company` details.
- Unknown id: **404** with the JSON body `"Not Found"`. The CLI exits 1 with
  `NOT_FOUND`.
- A 200 whose body is not a job with a numeric `id` (an API change) exits 1
  with `DETAIL_FAILED` instead of printing a bogus result.

## Public posting URL

`https://editx.eu/en/it-jobs/<id>/<slug>`, the link format the site's own job
cards use (`nl` and `fr` prefixes work too). The site resolves a posting by its
id; the slug is cosmetic. Being a single-page app, editx.eu answers 200 for any
path, so a 200 does not prove a posting exists; `detail` asks the API instead.

## robots.txt (2026-11-25)

`https://editx.eu/robots.txt`:

```
User-agent: *
Sitemap: https://editx.eu/sitemap_index.xml
Disallow:
```

`https://api.editx.eu/robots.txt`: Drupal's default. `User-agent: *` with
`Allow` rules for core CSS/JS/images and `Disallow` for `/core/`, `/profiles/`,
`/README.txt`, `/web.config`, `/admin/`, `/comment/reply/`, `/filter/tips`,
`/node/add/`, `/search/`, `/user/register`, `/user/password`, `/user/login`,
`/user/logout`, `/media/oembed`, `/*/media/oembed` and the same paths under
`/index.php/`. Nothing matches `/api/editx/`. No `Crawl-delay` on either host.

## Terms of Use

`https://editx.eu/en/terms-of-use` (the text ships inside the site's JavaScript
bundle). Section 1.1: "by clicking “Join Now”, “Sign Up” or similar,
registering, accessing or using our services ... you are agreeing to enter
into a legally binding contract with Editx." Section 3.3 "Agree with the code
of conduct" lists, among things users agree not to do: "Use scraping or similar
techniques, to collect content" and "Reverse engineer". The skill therefore
ships with a personal-use-only warning (see `SKILL.md`).

## Bot protection

None observed: Apache, no CDN/WAF headers, no rate-limit headers, no 403 or 429
with the honest User-Agent at a few requests per minute.
