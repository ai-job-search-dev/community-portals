# Into Design Systems MCP adapter reference

This adapter connects the Into Design Systems jobs MCP server to the
`ai-job-search` portal contract. It exposes only `search` and `detail`, the two
commands that contract defines; the server's other tools are out of scope for a
job portal (see [Tools not exposed](#tools-not-exposed)).

## Source

- `POST https://jobs.intodesignsystems.com/mcp`
- Request headers: `Content-Type: application/json`,
  `Accept: application/json, text/event-stream`,
  `User-Agent: Mozilla/5.0 (compatible; into-design-systems-cli/1.0)`
- JSON-RPC 2.0 over Streamable HTTP. The server may reply `text/event-stream`;
  the CLI reads the last `data:` JSON message.
- Live verified: 2026-09-03, server protocol `2025-03-26`, server name
  `into-design-systems-jobs`, version `1.0.0`.

The User-Agent names the tool rather than impersonating a browser, following the
convention every shipped portal CLI in `ai-job-search` uses.

## Methods and normalisation

| CLI command | MCP tool | Request | Result |
| --- | --- | --- | --- |
| `search` | `search_jobs` | `query`, `country`, `workType`, `postedAfter`, `postedBefore`, `limit` | Normalised portal results: `id`, `title`, `company`, `location`, `date`, `url`, plus source metadata |
| `detail` | `get_job` | `slug` | Full posting object; JSON is preserved and plain text is formatted for review |

`search_jobs` returns a text-content block containing JSON with `total`,
`returned`, `truncated`, `truncatedNote`, and `jobs`. Search fields observed
live: `title`, `company`, `city`, `country`, `remote`, `workType`, `aiSkills`,
`postingTextAvailable`, `posted`, `applyUrl`, `detailUrl`, `slug`, and
`summary`. Only map a missing value to `null`; never infer it from another
field.

`workType` already restricts results to postings that state an arrangement, so
the adapter does not also send `remote: true` — measured live, `workType` alone,
`remote` alone, and both together all return the same 58 roles.

## Listings without posting text

The board holds some listings without the posting text. Those carry no
`aiSkills` value, no `slug`, and no `detailUrl`, so `get_job` cannot read them.
They are roughly 30% of the board (72 of 240 open roles when last measured), and
they are **kept**, not dropped: `title`, `company`, `city`, `country`, `posted`,
and `applyUrl` are all present, which is everything `/scrape` needs to rank,
deduplicate, and track a lead.

Such a result has `id: null` and `detailUrl: null`, and `meta.withoutDetail`
counts them so the gap between `meta.count` and `meta.total` is explained rather
than silent. Call `detail` only on a result that has an `id`.

## Error handling

The server reports failure in three shapes. All three become a thrown error, so
nothing reaches stdout that a caller could mistake for a posting:

| Shape | When | Adapter code |
| --- | --- | --- |
| JSON-RPC `error` member | transport or protocol failure | the server's own code |
| `result.isError: true`, plain-text message | argument fails the tool's schema | `MCP_TOOL_ERROR` |
| Normal result, payload `{ "error": "…" }` | business logic, e.g. an unknown slug | `MCP_TOOL_ERROR` |

The third shape matters most: a `get_job` for a slug that does not exist comes
back as a *successful* result. Returned as-is it would print an empty posting
and exit `0`, which `/scrape` reads as a real job. The adapter raises it as an
error with exit `1` instead.

Errors are written to stderr as `{ "error": "…", "code": "…" }`. Codes:
`BAD_ARGUMENT`, `MCP_TOOL_ERROR`, `MCP_HTTP_ERROR`, `MCP_NETWORK_ERROR`,
`MCP_PROTOCOL_ERROR`, `INTERNAL_ERROR`.

### Date filters

`postedAfter` and `postedBefore` take a calendar date, `YYYY-MM-DD`. A full ISO
timestamp is accepted and read as its day. Any other format is rejected with a
message naming the parameter and the value received, and stating that no filter
was applied — the server's own description now puts it as "never a silently
ignored filter".

Until 2026-09-03 both were compared as strings with no format check, so a wrong
value matched everything or nothing depending on how it sorted, and a full ISO
timestamp shifted the window forward by a day. Reported upstream and fixed
server-side the same day.

The adapter validates before calling regardless. `--jobage` is rendered by
`daysAgoIso`, which can only emit `YYYY-MM-DD`, and `--before` must pass
`isCalendarDate`, which roundtrips the value through `Date` so shape-valid
impossibilities like `2026-13-45` and `2026-02-30` are refused locally. That
costs no round trip and reports a typo as `BAD_ARGUMENT` rather than as a
server error.

One date mistake the server still does not report: a window whose start falls
on or after its end returns zero roles without comment, which reads exactly
like an empty board. The adapter refuses that pairing.

## Operational constraints

- The service is read-only and exposes public listings. It never applies to a
  job.
- The adapter calls MCP directly and does not scrape board pages.
- `workType` is absent when the posting does not state an arrangement. Do not
  classify that as onsite.
- `aiSkills: false` only means the server has posting text and found no AI
  skill; listings without posting text are unknown, not false.
- `listingExpires` from `get_job` is board expiry metadata computed 60 days
  after posting, not an employer deadline.
- A truncated search is narrowed with `--jobage` and `--before`; there is no
  offset page, so `meta.page` is always `1`.
- Requests time out at 20s. Transient `429` and `5xx` responses are retried
  three times with exponential backoff and jitter. Network failures and other
  HTTP errors fail immediately, so one source cannot stall a multi-portal
  search. That is fewer retries than the portal contract's ~6: for an
  interactive job search, failing fast beats making the user wait.

## Tools not exposed

The server offers five tools; this adapter uses two. `hiring_stats` and
`list_companies` are board analytics rather than job records, and neither fits
the `search`/`detail` contract.

`find_learning` is the interesting one: it returns Into Design Systems
conference sessions that teach a named missing skill, which lines up closely
with this framework's `/upskill` command. Wiring it in would mean adding a third
command outside the portal contract, so it is deliberately left out of this
adapter rather than considered irrelevant.

## Credit and affiliation

The Into Design Systems job board and the MCP server this adapter calls are
built and maintained by [Sil Bormüller](https://github.com/silships), founder of
Into Design Systems, who publishes the endpoint as the board's documented
interface for agents. The board's availability, curation, and result quality are
theirs; this adapter is only a client of it.

This adapter was written by [Simon Di Fresco](https://github.com/SimonDiff). It
is not affiliated with, endorsed by, or sponsored by Into Design Systems or Sil
Bormüller. No part of that service is included or redistributed here — the
adapter only calls it over the network, and the listings it returns remain the
property of Into Design Systems and the employers who post them.
