# Company ATS Watchlist API Reference

The endpoints, parameters, and response schemas for querying direct ATS job boards across target companies.
Implemented by this CLI: Greenhouse, Lever (US host) and Ashby. All three are public, keyless JSON APIs. The reference below also records SmartRecruiters and Lever's EU host for completeness; the CLI does not query either of them yet.

## Supported ATS Providers & Endpoints

### 1. Greenhouse
- **Search / List Endpoint:** `GET https://boards-api.greenhouse.io/v1/boards/{company_slug}/jobs?content=true`
- **Detail Endpoint:** `GET https://boards-api.greenhouse.io/v1/boards/{company_slug}/jobs/{job_id}`
- **Authentication:** Keyless
- **Response Format:**
```jsonc
{
  "jobs": [
    {
      "id": 6136160004,
      "title": "Forward-Deployed Engineer",
      "absolute_url": "https://boards.greenhouse.io/vercel/jobs/6136160004",
      "location": { "name": "Remote - US" },
      "first_published": "2026-09-10T12:00:00Z",
      "updated_at": "2026-09-14T05:00:00Z",
      "content": "&lt;p&gt;Job description HTML...&lt;/p&gt;"
    }
  ]
}
```

### 2. Lever
- **Search / List Endpoint:** `GET https://api.lever.co/v0/postings/{company_slug}?skip={skip}&limit={limit}`
  The CLI pages this endpoint with `skip` in steps of 100 (`limit=100`) until a page returns fewer than 100 postings, so a large board is walked in full rather than truncated at the first page. The walk stops at 5,000 postings per board; a board larger than that is reported truncated by that bound, not by the page size.
- **Detail Endpoint:** `GET https://api.lever.co/v0/postings/{company_slug}/{posting_id}`
- **Authentication:** Keyless
- **Response Format:**
```jsonc
[
  {
    "id": "7d9af9b5-c1c7-48ec-bbb5-9b25e49f6596",
    "text": "Software Development Engineer III - Backend",
    "hostedUrl": "https://jobs.lever.co/meesho/7d9af9b5-c1c7-48ec-bbb5-9b25e49f6596",
    "applyUrl": "https://jobs.lever.co/meesho/7d9af9b5-c1c7-48ec-bbb5-9b25e49f6596/apply",
    "categories": { "location": "Bangalore, Karnataka", "team": "Engineering" },
    "workplaceType": "hybrid",
    "createdAt": 1789380000000,
    "descriptionPlain": "Job description text..."
  }
]
```

### 3. Ashby
- **Search / List Endpoint:** `GET https://api.ashbyhq.com/posting-api/job-board/{company_slug}?includeCompensation=true`
- **Detail Endpoint:** Retrieved from the board endpoint by `id` matching.
- **Authentication:** Keyless
- **Response Format:**
```jsonc
{
  "apiVersion": "1.0",
  "jobs": [
    {
      "id": "1fc309c8-da20-4ff2-84c7-8b863ece2b0a",
      "title": "Software Engineer, Developer Platform",
      "jobUrl": "https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a",
      "applyUrl": "https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a/application",
      "location": "San Francisco, CA or Remote (US)",
      "isRemote": true,
      "publishedAt": "2026-09-12T16:00:00.000Z",
      "compensation": {
        "compensationTierSummary": "$180,000—$240,000 USD"
      },
      "descriptionPlain": "Job description text...",
      "descriptionHtml": "<p>Job description HTML...</p>"
    }
  ]
}
```

### 4. SmartRecruiters (not queried by this CLI)
- **List Endpoint:** `GET https://api.smartrecruiters.com/v1/companies/{company_slug}/postings?limit=100`
- **Detail Endpoint:** `GET https://api.smartrecruiters.com/v1/companies/{company_slug}/postings/{posting_id}` (HTTP 404 = gone)
- **Country filter:** append `&country=in` (ISO country code) - measured 2026-10-07: `BoschGroup` reports 4,890 postings, and `&country=in` narrows it to 555.
- **Response fields:** `content[].id`, `content[].name`, `content[].location.{city,region,country}`, `content[].releasedDate` (the provider's own publish date), `content[].applyUrl`, `content[].active`; `totalFound` is the WHOLE board while `limit` bounds one page.

**Two traps.** The slug is **CASE-EXACT** - `BoschGroup` works and `bosch` answers HTTP 200 with an empty `content` and `totalFound: 0`, which looks like an empty board rather than a bad slug, so always read `totalFound`. And the list endpoint **paginates**: if `len(content) < totalFound` the listing is truncated and must not be reported as the whole board.

### 5. Lever - EU host (not queried by this CLI)
European tenants are served from a different host: `GET https://api.eu.lever.co/v0/postings/{company_slug}?mode=json`. The payload shape is identical to the US host, and the payload alone cannot tell you which host answered - so a European requisition URL (`jobs.eu.lever.co/...`) must be routed to `api.eu.lever.co`, or it 404s while the posting is live.

## Watchlist configuration (`watchlist.json` at the skill root, or `--watchlist <path>`)

```jsonc
[
  {
    "company": "Vercel",
    "provider": "greenhouse",
    "slug": "vercel",
    "keywords": ["frontend", "engineer", "react", "next.js", "typescript", "ai"]
  },
  {
    "company": "Notion",
    "provider": "ashby",
    "slug": "notion",
    "keywords": ["frontend", "engineer", "react", "product"]
  },
  {
    "company": "Meesho",
    "provider": "lever",
    "slug": "meesho",
    "keywords": ["engineer", "software", "backend", "ai"]
  }
]
```
