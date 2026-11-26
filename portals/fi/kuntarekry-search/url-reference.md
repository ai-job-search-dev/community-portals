# Kuntarekry.fi endpoint reference

Recorded 25.11.2026 from the public site; no login or key. Everything below
is what the site's own frontend requests. When the board changes, start here.

## Access rules

- `https://kuntarekry.fi/robots.txt`: `User-agent: *` / `Allow: /`.
  `www.kuntarekry.fi` redirects to the apex host; the CLI uses the apex and
  refuses redirects.
- No terms of use restricting automated reading are published on the site
  (only privacy notices: `/fi/tietosuojaseloste/`, `/fi/tietosuojalauseke/`).
- The service is run for Finnish municipalities by Kuntarekry (technology:
  Talentech; applications go to `kuntarekrytointi.fi`, which the CLI never
  requests).

## Search: `GET /fi/tyopaikat/[sivuN/]?format=json&includeTotal=1&limit=N&...`

Returns JSON `{ "jobs": [...], "total": <int> }` with `includeTotal=1`; without
it, a bare array. Newest first by default. The response's content type is
`text/html` even though the body is JSON.

| Parameter | Meaning |
|---|---|
| `format=json` | JSON instead of the HTML page |
| `includeTotal=1` | wrap the list as `{jobs, total}` |
| `limit` | page size; values above 48 are served as 48 |
| `/sivuN/` path segment | page N (the HTML pagination links use it), N = 1-999: `/sivu1000/` and up answer 301 to the HTML site for every `limit` (checked 25.11.2026); `offset`, `page`, `start` are ignored |
| `desc` | keyword; quotes stripped, words matched as an ordered substring, no operators |
| `region`, `location` | ids from filter data, comma-separated |
| `type`, `employment`, `hour`, `remote`, `organisationtype`, `profession`, `professioncat` | ids from filter data |
| `sort=publication_end` | closest deadline first (other values tried: `newest`, `date`, `deadline`, `relevance`: all ignored) |
| `view=count` | `{count}` only (the frontend's counter) |

Keyword totals stop at 500; the unfiltered total is the real size (1,644 on
25.11.2026).

Row fields used: `id` (number), `name` (URL slug, the CLI's id), `url`
(`/fi/tyopaikat/<name>/`), `title`, `profit_center`, `organisation_title`,
`location_tags` (array), `region`, `publication_date` / `publication_end`
(`d.m.yyyy`), `publication_time` / `publication_end_time`, `employment_type`,
`profession`, `ext_id` (job key), `published` (`"24h"` or empty), `anonymous`.

## Filter vocabulary: `GET /fi/api/filters-data/`

JSON with `locations` (20 regions, each with `children` municipalities),
`professions`, `organisations` (586), `languages`, `types` (Työpaikka,
Keikkatyö, Kesätyö, Harjoittelu, Oppisopimus, Työkokeilu, ...), `employments`
(Vakinainen, Määräaikainen), `hours`, `organisationTypes` (Hyvinvointialue,
Kunta, Yhtiö, Oppilaitos) and `remotes`. Each item is `{id, title[, type, children]}`.

## Detail: `GET /fi/tyopaikat/<slug>/`

HTML. `format=json` is not supported here. The CLI reads:

- `<script type="application/ld+json">` with `@type: JobPosting`: `title`,
  `hiringOrganization` (a string), `jobLocation.address.addressLocality` /
  `addressRegion`, `datePosted` (ISO), `baseSalary.value` (free text).
- `<job-view job-title="..." job-ext-id="...">`.
- `<p class="lead">`: the posting's lead paragraph.
- `<ip-details title="...">` sections: `Tehtävän kuvaus`, `Yhteystiedot`,
  `Lisätietoja organisaatiosta`, and `Työpaikan tiedot`, whose
  `<ip-aside-item title="...">` children hold `Työnantaja` (employer, then unit),
  `Työavain`, `Hakuaika` (`d.m.yyyy klo hh:mm - d.m.yyyy klo hh:mm`), `Tyyppi`,
  `Työsuhteen tyyppi`, `Työn alkamispäivä/ajankohta`, `Palkka`.
- `<a class="apply-button" href="...">`: the application link.

A closed posting returns 404.
