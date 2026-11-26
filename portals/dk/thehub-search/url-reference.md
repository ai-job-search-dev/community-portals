# The Hub public endpoints

Verified 26 October 2026 against public responses and the site's frontend
bundles. These are website endpoints, not a promised stable third-party API.

- Search: `GET https://thehub.io/api/v2/jobs`
- Detail: `GET https://thehub.io/api/jobs/single/<24-character-hex-id>`
- Posting URL: `https://thehub.io/jobs/<id>`
- The UI also uses `/api/v2/jobsandfeatured`, which wraps separate `jobs` and
  `featuredJobs` objects. The CLI uses `/v2/jobs` to avoid mixing promoted cards
  into the requested page.

| API parameter | CLI mapping |
|---|---|
| `search` | `--query` |
| `location` | `--location` |
| `countryCode` | `--country`; default `DK` unless global remote search |
| `isRemote=true` | `--remote` |
| `page` | `--page`, 1-indexed |
| `sorting=newJobs` / `mostPopular` | `--sort newest` / `popular` |

There is no verified native age filter. `--jobage` uses detail reads for the
selected page only. `--limit` is an output cap, not an API parameter. Geography
is the portal's own country/area behavior, not a guaranteed distance radius.
The site's `EU` option is labelled **Other Europe**, not all countries combined.

Search shape: `{total, limit, page, pages, docs: [...]}`. Observed page size: 15.
Each doc has `id`, `title`, `company.name`, `location.address` (or locality/country),
`isRemote`, and `jobPositionTypes` IDs. It omits dates and descriptions. The CLI
validates the envelope, skips/counts malformed rows, deduplicates IDs and fails
if a nonempty source page has no parseable jobs. Genuine empty pages succeed.

Details are a single object with the same identity and summary fields plus:

- `description`: HTML, converted to text without executing markup.
- `publishedAt`, `createdAt`: ISO timestamps. Prefer publication; never infer
  age from the Mongo-style ID or from the local retrieval date.
- `expirationDate`: portal expiry; may differ from the employer's deadline.
- `status`: e.g. `ACTIVE`; preserved alongside a nullable `isActive` flag.
- `link`: external employer application URL, when present.
- `salary`, `equity`: source labels (no invented salary amounts).

Position-type IDs and labels were taken from the public page's `meta.job`
configuration. Unknown future IDs pass through instead of being dropped.

Reconnaissance sources: [jobs](https://thehub.io/jobs),
[robots.txt](https://thehub.io/robots.txt), [terms](https://thehub.io/terms).
The checked robots file disallowed only `/startups/joblistwidget/`; search and
detail paths were not disallowed. The terms (checked 25.11.2026) contain no
specific automated-access prohibition, but they let users view and print the
content for personal, non-commercial use only and forbid other copying,
saving or reuse without written consent. This tool is therefore documented as
personal use only (SKILL.md, cli/README.md): one person's own job search, low
volume, nothing republished or stored in bulk. Access remains subject to the
current site rules.
Public reads worked with `Mozilla/5.0 (compatible; thehub-cli/1.0)` and no cookies
or credentials. Do not add authenticated, application-submission or subscription
operations to this search tool.

Fixture provenance: `cli/tests/fixtures/` contains reduced public search/detail
responses from this verification. Company data is reduced to its name and the
description is shortened; they test schemas without retaining entire postings.
