# Workable account endpoints — URL reference

Recorded 2026-11-25 from live responses against account `digitalgenius`
(3 postings, 8 widget rows). Workable documents the list endpoint under **Public
Endpoints**: `GET https://www.workable.com/api/accounts/{subdomain}` (optional
`?details=true`). It 302s to
`https://apply.workable.com/api/v1/widget/accounts/{subdomain}`, which is what `search`
reads through the documented URL.

The public single-job endpoint
`GET https://www.workable.com/api/jobs/{shortcode}?details=true` also exists. It returns
one primary location and one combined description, so `detail` uses the board's account
job endpoint for every location plus separate requirements and benefits.

Workable's token-authenticated API (https://workable.readme.io) is the SPI v3 at
`<subdomain>.workable.com/spi/v3`, scoped to one account's own recruiting data (jobs,
candidates, employees). It needs a token generated from that account's Integrations page,
so it cannot power a job-seeker portal that reads arbitrary companies' boards. This skill
uses the public board endpoints below, which need no account.

## Hosts

| Host | Role |
|------|------|
| `apply.workable.com` | Board pages (`/<slug>/j/<shortcode>`) and the account job endpoint (`/api/v1/accounts/<slug>/jobs/<shortcode>`) used by `detail`. |
| `<slug>.workable.com` | Legacy tenant host (`/j/<shortcode>`), 301s to `apply.workable.com`. Accepted as `detail` input, never fetched. |
| `www.workable.com`, `workable.com` | Documented public API (`/api/accounts/<slug>`, `/api/jobs/<shortcode>`) and share links (`/j/<shortcode>`). `robots.txt` disallows `/j/` and admin/auth paths but allows `/api/`; `/j/` links are parsed, never fetched. |

`robots.txt` on `apply.workable.com`:

```
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Disallow:
```

`Disallow:` is empty, so every path is allowed. `www.workable.com` disallows `/j/` (and
admin/auth paths) but allows `/api/`; the CLI calls `/api/` and never fetches a `/j/`
share link. No authentication is required for GET.

## Endpoints

| Purpose | Request |
|---------|---------|
| Board info + every posting (documented) | `GET https://www.workable.com/api/accounts/{slug}` → 302 → `GET /api/v1/widget/accounts/{slug}` → `{ name, description, jobs: [...] }` |
| List with descriptions | `GET https://www.workable.com/api/accounts/{slug}?details=true` (each row gains `description`; not used by search) |
| One posting (used) | `GET /api/v1/accounts/{slug}/jobs/{shortcode}` → one job object |
| One public posting (not used) | `GET https://www.workable.com/api/jobs/{shortcode}?details=true` → one row, primary location only |

Errors: unknown account or shortcode → HTTP 404. The public job endpoint returns
`{"error":"not-found"}`; the account endpoints return plain `Not Found`. `v2` also
answers on `/api/v2/accounts/{slug}/jobs/{shortcode}`; the CLI accepts either version in
`detail` URL input and calls `v1` itself.

## Parameters (CLI → API)

| CLI flag | API | Notes |
|----------|-----|-------|
| `--board` | path `{slug}` | Validated `^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$` |
| `--query` | — | Client-side: all terms in `title` |
| `--location` | — | Client-side: substring of the joined location |
| `--remote` | — | Client-side: `workplace_type` normalized to `remote`/`hybrid`/`onsite`, falling back to `telecommuting: true` → `remote`. A board with no `workplace_type` gets a `WORKPLACE_TYPE_UNAVAILABLE` warning for `hybrid`/`onsite`. |
| `--jobage` | — | Client-side: `published_on` (fallback `created_at`) |
| `--page` | — | Client-side: 20 per page, sorted newest first |
| `--limit` | — | Client-side: caps the page after slicing, so a page can return fewer than 20 |

The list endpoint returns the whole board and has no page, offset or limit parameter.

## List row fields

`title`, `shortcode` (the posting ID in URLs), `code` (internal reference), `url` and
`shortlink` (both `https://apply.workable.com/j/<shortcode>`), `application_url`,
`employment_type` (`Full-time`, `Part-time`, `Contract`, ...), `telecommuting` (boolean),
`workplace_type` (`on_site`, `hybrid`, `remote`; documented, but the recorded responses
omit it — `telecommuting` is the fallback),
`department`, `city`, `state`, `country`, `locations[]` (one entry per row),
`published_on` (date), `created_at` (date), `experience`, `education`, `function`,
`industry`, `description` (only with `?details=true`).

**Multi-location fan-out:** one posting open in several places arrives as one row per
location, all sharing the same `shortcode`, `title`, `shortlink` and `published_on` and
differing only in `city`/`state`/`country`. Each row's `locations[]` holds only that
row's location. The CLI folds rows by `shortcode`, joins the locations with ` ·`, and
appends `Remote` when `telecommuting` is true and no location already says it.

## Detail fields

`id` (number), `shortcode`, `title`, `remote` (boolean), `location` (object),
`locations[]` (complete list; `region` is the geographic state), `state` (publication
status, e.g. `published`, not geography), `code`, `published` (ISO 8601 timestamp), `type`
(`full`, `part`, `contract`, `temporary`, `internship`, `other`), `language`,
`department` (array of strings), `accountUid`, `approvalStatus`, `workplace`
(`remote`, `hybrid`, `on-site` on the wire; output normalizes it to `remote`, `hybrid`,
`onsite`), `description`, `requirements`, `benefits` (each HTML).

No company display name, salary, deadline or experience field is returned.

## Mapping to the portal-skill contract

`id` ← `shortcode`, `title` ← `title`, `company` ← the public board response's `name` in
search and the board slug in detail, `location` ← search: the row's
`city`/`state`/`country`; detail:
`location`/`locations[].city`/`region`/`country` (detail's top-level `state` is the
publication status, not geography). The region is kept when it differs from the city.
`department` ← the row's `department` in search or
the joined detail `department[]` (also exposed as `departments[]`), `employmentType` ←
`employment_type` in search or `type` in detail, `workplace` ← `workplace_type` in
search or `workplace` in detail, both normalized to `remote`/`hybrid`/`onsite`
(`on_site`/`on-site` → `onsite`); search falls back to `telecommuting: true` → `remote`,
`requisitionId` ← `code`, `date` ←
`published_on` (search) or `published` (detail), `url` ←
`https://apply.workable.com/<slug>/j/<shortcode>`.
