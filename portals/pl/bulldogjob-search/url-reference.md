# Bulldogjob URL & data reference

Checked 2026-11-09. Site: Next.js; data is embedded JSON, no separate public API used.

## robots.txt
`User-agent: *` disallows `/Pzit*`, `/auth`, `/page`, `/feeds`, `/authors`, `/withSalary,true`,
`/salaryBrackets`, `/account`, `/faq`, `/files`, `/index`. `/companies/jobs` and `/companies/jobs/*`
are allowed. Terms page (`/terms`) returned HTTP 403 to automated fetch.

## List pages
`GET https://bulldogjob.pl/companies/jobs[/s/<key>,<value>[/<key>,<value>...]]`

| Segment | Values / notes |
|---------|----------------|
| `skills,<name>` | Case-insensitive (`PHP`=`php`). Unknown name -> 0 results |
| `role,<name>` | e.g. `backend` |
| `experienceLevel,<lvl>` | `junior`, `medium`, `senior`, `lead` (`mid`/`regular` -> 0 results) |
| `city,<name>` | Only the cities in `pageProps.jobsLocations` + `Remote`. **An unknown city is silently treated as Remote**, so the CLI validates against its own list |
| `page,<n>` | 50 offers per page; past the end returns an empty `jobs` list (200) |

Ignored by the server (return the full ~957 offers): `term`, `contract`, `salary`, `employmentType`,
`remote,true`, query strings `?q= ?search= ?query=`.

Data: `<script id="__NEXT_DATA__" type="application/json">` -> `props.pageProps`:
- `jobs[]` - `id` (slug `<num>-<title>-<city>-<company>`), `position`, `company.name`, `city`, `remote`,
  `experienceLevel`, `employmentType`, `contractB2b/Employment/Other`, `showSalary`,
  `denominatedSalaryLong{money,currency,hidden}`, `technologyTags[]`. **No date.**
- `totalCount`, `jobsLocations[]`, `__APOLLO_STATE__` (`searchJobs({... "perPage":50})`).

## Detail pages
`GET https://bulldogjob.pl/companies/jobs/<id-slug>` (a bare numeric id 308-redirects to the slug; unknown -> 404).
`props.pageProps.__APOLLO_STATE__["Job:<slug>"]`: `position`, `details` (HTML), `requirements`/`offer`
(HTML or null), `publishedAt`, `endsAt`, `state` (`published`), `workModes` (`on-site`/`hybrid`/`full-remote`),
`workFrom[]` (countries), `locations[].location.{cityPl,cityEn}`, `b2bSalary/employmentSalary/otherSalary`
(`money`, `currency`, `timeframe`), `technologyTags`, `minExperienceInYears`, `company.__ref` -> `Company:<id>` (`name`).
Next.js escapes `<` as `<` inside the JSON, so `</script>` never appears within it.

## Fetching
Honest UA `Mozilla/5.0 (compatible; bulldogjob-cli/1.0)` works (HTTP 200, no bot wall observed).
Backoff on 429/5xx, `""` on 404.
