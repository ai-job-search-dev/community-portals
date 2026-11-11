---
name: into-design-systems-search
version: 1.0.0
description: >
  Use this skill whenever the user is looking for Design System roles, design
  tokens work, design engineering, or AI-adjacent product design jobs — anywhere
  in the world, and even if they never mention Into Design Systems by name. The
  board is a hand-verified, global directory of Design System roles for both
  designers and engineers, so it is the right source for a specialization search
  rather than a country search. Trigger phrases include: design systems jobs,
  design system role, design systems engineer, design systems designer, design
  tokens job, design engineer job, design ops job, component library role,
  Figma systems role, product designer design systems, staff design systems,
  AI design jobs, agentic design jobs, MCP design role, design system architect,
  into design systems, IDS jobs.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/into-design-systems-search/cli/src/cli.ts *)
---

# Into Design Systems Search

Searches the [Into Design Systems](https://jobs.intodesignsystems.com) job board,
a curated, hand-verified directory of Design System roles worldwide. Unlike the
national portals in this framework, this one is scoped by **specialization**
rather than by country — use `--country` to narrow it to a market.

This is an MCP adapter: its Bun CLI calls the board's public, read-only MCP
server and normalises responses into the portal `search`/`detail` contract, so
`/scrape` can deduplicate, rank, and track these results alongside every other
portal. Do not replace it with page scraping. No account, key, or login.

## Commands

```bash
# Search — every flag is optional, but a query or country keeps results useful.
bun run .agents/skills/into-design-systems-search/cli/src/cli.ts search \
  --query "design systems" --country Germany --remote remote --jobage 14 --limit 20

# Read one posting by slug or by its Into Design Systems detail URL.
bun run .agents/skills/into-design-systems-search/cli/src/cli.ts detail \
  gitlab-senior-product-designer-ai-dtkb4g --format plain
```

Query syntax: one case-insensitive substring matched against title, company and
summary. Phrase quoting is not honoured — quote characters are matched literally.
No boolean operators, no negation, no wildcards, and no word-boundary matching, so
a multi-word query matches only as one contiguous run and word order matters:
`design tokens` returns 48 roles, `tokens design` returns none. Send one phrase in
the order a posting would write it, and use separate searches instead of `OR`.

## Access and terms

The board publishes this MCP server as its documented interface for agents, free,
keyless and read-only, and announces it on the board's own homepage. The adapter
calls only that endpoint. It does not fetch, parse, or crawl any board page, so no
`robots.txt` path is involved, and there is no scraping workaround to review. The
listings themselves stay the property of Into Design Systems and the employers who
post them; use them accordingly.

### Examples

```bash
# Recent design-token and systems work, scanned quickly.
… search -q "design tokens" --jobage 14 --format table

# One market, one work arrangement.
… search --country Germany --remote hybrid --limit 50

# Remote-only senior roles across the whole board.
… search -q staff --remote remote --format table

# Walk past the 100-result cap: newest window first, then older windows.
… search --jobage 30 --format json
… search --jobage 60 --before 2026-08-01 --format json
```

## Flags

| Flag | Meaning |
| --- | --- |
| `--query`, `-q` | Free text matched against title, company, and summary. |
| `--country`, `-l` | One country or region, matched whole: `Germany`, `USA`, `EMEA`. |
| `--remote` | `remote`, `hybrid`, or `onsite`. Only postings that state one. |
| `--jobage <days>` | Posted within N whole days (lower bound). |
| `--before <YYYY-MM-DD>` | Posted before this day, exclusive (upper bound). |
| `--limit`, `-n` | 1–100, default 20. |
| `--format` | `json` (default), `table`, `plain`. |

**There is no `--page`.** The board has no offset paging, so `meta.page` is
always `1`. A search that returns `"truncated": true` is narrowed by pairing
`--jobage` with `--before` and walking backwards in date windows until each
window comes back untruncated.

A missing work type means the posting does not state one; it is never onsite.

## Output

`search --format json` follows the portal contract:

```json
{
  "meta": { "count": 20, "page": 1, "total": 128, "truncated": true, "withoutDetail": 4 },
  "results": [{ "id": "slug", "title": "…", "company": "…", "location": "…", "date": "YYYY-MM-DD", "url": "…" }]
}
```

`meta.withoutDetail` counts results whose `id` is `null`. The board holds some
listings without posting text; those have no slug and no detail page, so
**`detail` cannot read them** — but their title, company, location, date, and
apply URL are complete, so they are returned and worth ranking. Call `detail`
only on a result that has an `id`.

## Evidence

Use `detail` before making a fit claim. Quote requirements in the posting's own
words, preserve stated salary and currency exactly, and treat absent text, work
arrangement, salary, or company detail as unknown rather than as absent.

- `aiSkills: false` means the board has the posting text and found no AI skill.
  A listing without posting text is unknown, not false.
- `listingExpires` from `detail` is the board's own expiry date, computed 60
  days after posting. It is never an employer deadline.

For transport details, field normalisation, and error handling, read
[url-reference.md](url-reference.md).
