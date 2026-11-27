# Apify API reference

The endpoints, parameters and response shapes this skill depends on. Update this
file when the Actor's input or the Apify API changes.

Base URL: `https://api.apify.com/v2`, overridable with `GOOGLE_JOBS_SEARCH_API_URL`
(tests point it at a loopback server). The only other environment variable is
`APIFY_API_TOKEN`.

## Authentication

Every request carries `Authorization: Bearer <APIFY_API_TOKEN>`. The token is
never put in a URL, a log line or an error message. When `APIFY_API_TOKEN` is
unset or blank, the CLI exits with `MISSING_TOKEN` before it sends any request;
`AUTH` is not used for a missing token.

| Response | CLI code | Meaning |
|----------|----------|---------|
| `401`, `403` | `AUTH` | The API rejected the token: it is invalid, revoked or lacks access. |
| `402` | `QUOTA` | The Apify account has no remaining quota. |
| `other non-2xx` | `HTTP_ERROR` | Surfaced with a truncated response body (the first 500 characters). |

### Retry and failure policy by method

- **GET** (run polls, dataset reads): retried on `429` and on `5xx`, and on a
  network failure or request timeout. The schedule is the portal contract's:
  500 ms doubling to 8 s, six retries, each wait plus 0–499 ms of jitter. A
  failure that survives all retries is `HTTP_ERROR`.
- **POST** (Actor run start): retried on `429` only, because the request was
  refused and nothing started. A `5xx`, a network failure or a timeout is
  **not** retried and is `HTTP_ERROR` at once: the run may already have started,
  and every run is billed.
- Any fetch that rejects (network error, `AbortSignal` timeout) is wrapped in
  `HTTP_ERROR`, and the message names the original error name.

## `POST /acts/krammer~google-jobs-scraper/runs?waitForFinish=60`

Starts the Actor and asks Apify to hold the response until the run finishes, for
at most 60 seconds. Body: the Actor input JSON.

Actor input fields the CLI sets:

| Field | CLI flag | Value |
|-------|----------|-------|
| `queries` | `--query` / `-q` | `[query]` — one query per run. |
| `locations` | `--location` / `-l` | `[location]`. Omitted when no location is given. |
| `country` | `--country` | `us` \| `gb` \| `in` \| `de`. Default `us`. |
| `datePosted` | `--jobage` | `24h` \| `3d` \| `7d` \| `30d` \| `any`. `--jobage 1` → `24h`, `2`–`3` → `3d`, `4`–`7` → `7d`, `8`–`30` → `30d`, more than `30` or unset → `any`. |
| `maxResultsPerSearch` | (derived) | `page × limit`, at most `200`. |
| `remoteOnly` | `--remote` | `true` when the flag is set. Omitted otherwise. |

Response: `{ "data": { "id", "status", "statusMessage", "defaultDatasetId", "startedAt", "finishedAt" } }`.
`data.status` one of `READY`, `RUNNING`, `SUCCEEDED`, `FAILED`, `ABORTED`,
`TIMED-OUT`. Only the last four are terminal.

## `GET /actor-runs/{id}?waitForFinish=60`

Re-reads a run that was not terminal after the start request. Called up to five
times. A run still not terminal after that is `RUN_TIMEOUT`, and the error names
the run id. A terminal status other than `SUCCEEDED` is `RUN_FAILED`, and the
error carries the status and `statusMessage`.

## `GET /datasets/{datasetId}/items?offset=<n>&limit=<n>&clean=true`

Reads records from the run's dataset. `clean=true` returns the records as the
Actor stored them, without Apify's own metadata fields.

- `search` reads page N with `offset = (page - 1) × limit` and `limit = limit`.
- `detail` reads one record with `offset = <the id's offset>` and `limit = 1`.
- An empty array is `NOT_FOUND` for `detail`, and an empty result set for `search`.
- A `404` from the API (an expired or missing dataset) is `NOT_FOUND` for
  `detail`, the same outcome as an empty page.

### Record fields the CLI reads

```jsonc
{
  "job_id": "MvRxJMVzya6WKLAPAAAAAA==",
  "title": "Part-Time Full Stack Software Engineer - AI Trainer",
  "company": "DataAnnotation",
  "location": "San Francisco, CA",
  "description": "About the Role: …",       // plain text
  "apply_options": [                         // [{title, link}]
    { "title": "Apply on SaluteMyJob", "link": "https://…" }
  ],
  "salary": "135K–190K a year",              // or null
  "salaryMin": 135000,                       // number or null
  "salaryMax": 190000,
  "salaryCurrency": "USD",
  "salaryPeriod": "year",
  "jobTypes": ["FULLTIME"],                  // machine tag list
  "job_type": "Full-time",                   // display string (not used)
  "workMode": "remote",                      // or null
  "postedDate": "2026-11-26",                // YYYY-MM-DD
  "posted": "22 hours ago",                  // display string (not used)
  "postedHoursAgo": 22,
  "country": "us",
  "searchQuery": "software engineer",
  "searchLocation": "San Francisco, CA",
  "highlights": [ { "title": "…", "items": ["…"] } ],
  "benefits": ["…"] | null
}
```

Mapping to a result:

| Result field | Source |
|--------------|--------|
| `id` | `<datasetId>:<record offset in the dataset>` |
| `title`, `company`, `location`, `description` | the same-named field, or `null` |
| `date` | `postedDate` as `YYYY-MM-DD`, or `null` |
| `url` | the first `http(s)` `apply_options[].link`, or `null` |
| `salary`, `salaryMin`, `salaryMax`, `salaryCurrency`, `salaryPeriod` | the same-named field, or `null` |
| `workMode` | `workMode`, or `null` |
| `jobTypes` | `jobTypes`, or `[]` |
| `apply_options` | `[{title, link}]` for each option with an `http(s)` link, or `[]` |

Every string passes through the CLI's `stripInvisible` before output. An apply
option whose `link` is not `http:`/`https:` (or does not parse as a URL) is
dropped, so `apply_options` and `url` never carry another scheme.

## Notes

- The Actor has no offset parameter. Page N costs a run that returns
  `page × limit` results; the CLI slices the page client-side.
- Record order inside a dataset is stable, which is why an offset is a safe id.
- Datasets expire on Apify's retention schedule. `detail` on an expired dataset
  answers `NOT_FOUND`.
