# Ashby Job Postings API - URL reference

Recorded 2026-11-09 from live responses across several boards; fields re-checked 2026-11-16
against `linear` and `ramp`. Official docs: https://developers.ashbyhq.com/docs/public-job-posting-api

## Hosts

| Host | Role |
|------|------|
| `api.ashbyhq.com` | Public Job Postings API. What the CLI calls for jobs. No robots.txt (`/robots.txt` returns 401). No auth for the posting API. |
| `jobs.ashbyhq.com` | Human-facing boards (`/<board>`, `/<board>/<job id>`, `/<board>/<job id>/application`). The CLI reads `/<board>` once for the company name. robots.txt: `Disallow: /meeting/`, `/b/`, `/api/`. |
| Company domains | Embedded boards use `?ashby_jid=<job id>` (e.g. `example.com/careers/?ashby_jid=...`); the board slug is not in the URL. |

## Endpoints

| Purpose | Request |
|---------|---------|
| Whole board (with pay) | `GET https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true` → `{ jobs: [...], apiVersion }` |
| Company name | `GET https://jobs.ashbyhq.com/{board}` → HTML; `window.__appData = {...}` → `organization.name` |

There is no public single-job endpoint, so `detail` loads the board and selects the job by
`id`. Unknown board → HTTP 404. The board response always includes descriptions; there is
no paging or server-side filter.

`window.__appData` is followed by more script in the same `<script>` tag, so it is
extracted by brace matching (string-aware), not by an end-of-script regex. Other keys:
`organization.{hostedJobsPageSlug, publicWebsite, customJobsPageUrl}`, `jobBoard`, `posting`.

## Parameters (CLI → API)

| CLI flag | API | Notes |
|----------|-----|-------|
| `--board` | path `{board}` | Validated `^[A-Za-z0-9._-]{1,100}$`, never `.` or `..`; comma list up to 25 |
| `--query` | - | Client-side: all words in `title` |
| `--location` | - | Client-side: substring of `location` or any `secondaryLocations[].location` |
| `--remote` | - | Client-side: `workplaceType` (`Remote`/`Hybrid`/`OnSite`), else `isRemote`, else "Remote" in a location (remote only) |
| `--jobage` | - | Client-side: `publishedAt` |
| `--page` | - | Client-side: 20 per page, newest first |
| `--limit` | - | Client-side: caps the page after slicing, so a page can return fewer than 20 |

## Job fields

`id` (UUID), `title`, `department`, `team`, `employmentType` (`FullTime`, ...),
`location`, `secondaryLocations[]` (`{ location, address.postalAddress.{addressLocality,
addressRegion, addressCountry} }`), `publishedAt` (ISO 8601), `isListed`, `isRemote`
(often null), `workplaceType` (`Remote`/`Hybrid`/`OnSite`/null), `address`, `jobUrl`,
`applyUrl`, `descriptionHtml`, `descriptionPlain`, `shouldDisplayCompensationOnJobPostings`,
and with `includeCompensation=true`:

```
compensation: {
  compensationTierSummary: "$160K – $210K • Offers Equity",
  scrapeableCompensationSalarySummary: "$160K - $210K",
  compensationTiers: [{ tierSummary, components: [
    { compensationType: "Salary" | "EquityPercentage" | ..., interval: "1 YEAR",
      currencyCode: "USD", minValue, maxValue, summary } ] }]
}
```

`descriptionHtml` wraps list items in `<p>`; the text renderer keeps consecutive bullets
on consecutive lines. The description is built from the HTML (not `descriptionPlain`) so
hidden markup is dropped.

## Mapping to the portal-skill contract

`id` ← `id`, `title` ← `title`, `company` ← `organization.name` (board page) ?? board slug,
`location` ← `location`, `date` ← `publishedAt`, `url` ← `jobUrl` ?? `https://jobs.ashbyhq.com/<board>/<id>`.

`search` leaves out jobs with `isListed === false`; `detail` still returns them, with
`isActive: false`.
