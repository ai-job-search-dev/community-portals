# GameJobs.co URL Reference

Public, unauthenticated, server-rendered pages used by this skill. Recorded 2026-11-16.

## robots.txt and terms

- `User-agent: *` disallows only `/jobs/*/save`. Named AI-training and SEO crawlers
  (GPTBot, ClaudeBot, CCBot, AhrefsBot, ...) are disallowed from `/`; this CLI identifies
  itself as `gamejobs-cli/1.0` and is a user-run search tool, not one of those crawlers.
- The site's FAQ documents search-result feeds (`&format=atom`) and the `-term` exclusion
  operator. No terms page restricts automated reading of public listings.
- The skill stays off the `/jobs/<id>/save` endpoints and every logged-in page.

## Search

```
GET https://gamejobs.co/search
```

| Param | Meaning | Example |
|-------|---------|---------|
| `q` | Keywords. `"..."` exact phrase (order counts), `OR` union, `-term` exclude | `unity developer` |
| `w` | Where: city, state, country, or `Remote` | `Remote`, `Canada`, `London, United Kingdom` |
| `a` | Posted within: `1d`, `7d`, `31d` only (any other value is ignored and returns all dates) | `7d` |
| `p` | Page, 1-indexed, 100 results per page | `2` |
| `c` | Company (exact) | `Unity` |
| `e` | Experience level | `Senior`, `Lead`, `Junior` |
| `k` | Employment kind | `Contract`, `Full Time` |
| `t` | Category | `Art`, `Engineering` |
| `format` | `atom` returns the same results as an Atom feed (title, link, exact `updated`; no company or location fields) | `atom` |

The CLI uses `q`, `w`, `a` and `p`. Results are relevance-ordered, not date-ordered.

### Response anchors (HTML)

- Total: `<div class="summary">1,083 results</div>`
- Next page: `<a class="btn-hollow flex1" href="/search?p=2&amp;q=...">Next</a>`
- One card per posting, split on `<div class="job">`:
  - title + slug: `<a class="title" href="/<slug>">Title with <em>highlight</em></a>`
  - company: `<a href="/search?c=..." class="c">Company</a>` (may be absent)
  - location(s): one or more `<a href="/search?w=..." class="w">Place</a>`
  - age: bare text between ` · ` separators, before the save form: `· 7 days ago · <form`
  - numeric id: `<form ... action="/jobs/1431041/save" data-job-id="1431041">`
- A dismissible banner `<div data-nosnippet class="banner-ad flash">` sits above the
  cards and must not parse as a job.

## Detail

```
GET https://gamejobs.co/<slug>
```

The slug is the only working key (`/jobs/<id>` and `/<id>` return 404). An unknown or
removed slug returns 404.

- `<script type="application/ld+json">` with a schema.org `JobPosting`: `title`,
  `datePosted` (exact), `validThrough`, `employmentType`, `hiringOrganization.name`,
  `jobLocation[].address`, `identifier.value` (numeric id), `description` (HTML).
- `<article class="w800">`: `<h1>` title, `.c` company, `.w` location(s), a `<div>` with
  the relative age, an `<a class="btn ...">Apply</a>` external link, and
  `<div class="job-description">` with the rendered description.

## Notes

- Relative ages: `today`, `N hours ago`, `N days ago`, `1 month ago`, `N months ago`,
  `1 year ago`. Months/years are coarse; the CLI approximates them as 30/365 days.
- Postings are in whatever language the studio wrote them (French, Chinese, ...).
- No rate limit was hit during reconnaissance (~25 requests over a few minutes).
