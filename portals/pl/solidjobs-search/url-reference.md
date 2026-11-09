# SOLID.Jobs: URL and API reference

Investigated 2026-11-02. Official docs: https://solid.jobs/api-ofert-pracy, plus
the MIT-licensed client repo `solid-company/solid-jobs-client` on GitHub
(`README.md` and `DICTIONARIES.md` hold the parameter and enum lists).

## Access

- `robots.txt`: `User-agent: *` → `Allow: /`, `Disallow: /management/`, `Disallow: /admin/`.
  GPTBot, ClaudeBot, anthropic-ai and others are listed explicitly with the same rules.
- No key, account or OAuth. The `campaign` query parameter is **required** on every
  API call: lowercase letters, digits and dashes, up to 64 characters. It is used
  for analytics only. This CLI sends `ai-job-search-cli`.
- Limits: 300 requests/min per IP, with a queue of 10. Responses are cached for 1 hour. Over the limit → `429`.
- The honest UA `Mozilla/5.0 (compatible; solidjobs-cli/1.0)` is accepted by both the API and the offer pages.

## Search: `GET https://solid.jobs/public-api/offers/{division}`

`{division}`: `IT`, `Engineering`, `Marketing`, `Sales`, `HR`, `Logistics`, `Finances`, `Other`
(an invalid value → `400` with a plain-text message).

| Parameter | CLI flag | Notes |
|-----------|----------|-------|
| `campaign` | (constant) | required |
| `pageIndex` | `--page` minus 1 | 0-based |
| `pageSize` | (fixed 50) | max 500, default 30 |
| `sortActive` | (fixed `validFrom`) | also `validTo`, `title`, `company`, `salaryFrom`, `salaryTo`, `experienceLevel` |
| `sortDirection` | (fixed `desc`) | `asc` / `desc` |
| `search.searchTerm` | `--query` | full-text. **A bare `searchTerm` is silently ignored**, so it must carry the `search.` prefix |
| `search.cities` | `--location` | comma-separated |
| `search.categories` | `--category` | e.g. `Developer`, `Architect`, `DevOps`, `ItManager`, `Analyst` |
| `search.subCategories` | `--subcategory` | e.g. `PHP`, `Python`, `DotNet`, `Java`, `JavaScript`, `Golang` |
| `search.experiences` | `--experience` | `Intern`, `Junior`, `Regular`, `Senior` |
| `search.minimumSalary` | `--min-salary` | lower bound ≥ value |

An invalid enum value → `400` with an RFC 9110 problem JSON
(`{"errors":{"search.Categories":["The value 'X' is not valid."]},...}`). The CLI
surfaces this as `BAD_REQUEST`. There is no remote or date parameter, so the CLI
applies `--remote` and `--jobage` client-side.

### Response

```json
{
  "pageIndex": 0, "pageSize": 50, "totalCount": 96, "totalPages": 2,
  "jobs": [{
    "jobOfferKey": "<uuid>",
    "title": "...", "division": "IT", "category": "Developer", "subCategory": "PHP",
    "company": "...", "companyLogoUrl": "...",
    "salary": { "from": 20200.0, "to": 25200.0, "currency": "PLN", "period": "Month", "employmentType": "B2B" },
    "secondarySalary": null,
    "contractTime": "full_time",
    "locations": ["Warszawa"], "isRemote": true, "isHybrid": false,
    "url": "https://solid.jobs/o/<code>/<campaign>",
    "experienceLevel": "Senior",
    "skills": [{ "name": "PHP", "level": "Advanced" }],
    "languages": [{ "name": "Polski", "level": "Expert" }],
    "benefits": ["..."],
    "description": "<div class=\"well job - description\">...HTML...</div>",
    "validFrom": "2026-11-02T10:51:19.3995326+01:00",
    "validTo": "2026-12-03T10:51:19.3995326+01:00",
    "updatedAt": "..."
  }]
}
```

Contract mapping: `id` = `<code>` from `url` · `date` = `validFrom[0:10]` ·
`deadline` = `validTo[0:10]` · `location` = `locations.join(", ")` (or `"Remote"`
when empty and `isRemote` is set) · `url` = `https://solid.jobs/o/<code>` (campaign stripped).

## Detail: offer page JSON-LD

The API has no single-offer endpoint. `GET https://solid.jobs/o/<code>` 302-redirects
to `https://solid.jobs/offer/<number>/<slug>`, an Angular SSR page carrying:

- `<script type="application/ld+json">` with `"@type": "JobPosting"`, which provides
  `title`, `description` (HTML), `hiringOrganization.name`, `datePosted` (YYYY-MM-DD),
  `validThrough` (ISO), `employmentType` (`CONTRACTOR` …), `jobLocation.address.addressLocality`,
  `jobLocationType` (`TELECOMMUTE` = remote), `baseSalary.value.{minValue,maxValue,unitText}`,
  `experienceRequirements.monthsOfExperience` and `skills` (a comma-separated string).
  The page has two other JSON-LD blocks, `WebSite` and `Organization`, which are ignored.
- `<script id="ng-state" type="application/json">`: the transfer state, which includes
  `{"isFound":..,"isExpired":..,"jobOfferDetails":{..}}`. The CLI reads only `isExpired`.

## Other feeds (not used)

- `https://solid.jobs/rss/job-offers`: an RSS dump of all offers (~3,750 items, ~1.7 MB).
  It has title, company, location and salary in `description`, plus `pubDate`. It is a
  fallback if the API ever disappears.
- `/public-api/market-statistics/{scopeKind}/{scopeKey}`: aggregated salary and demand statistics.
