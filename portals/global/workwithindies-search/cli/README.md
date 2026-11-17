# workwithindies-cli

CLI for searching indie game studio jobs in [Work With Indies](https://www.workwithindies.com)'
public RSS feed (the 100 newest postings, mostly remote).

**Data source**: `https://www.workwithindies.com/careers/rss.xml`, and nothing else.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is optional
and only pulls dev type definitions.

> **Feed only.** The board's terms forbid scraping, so this CLI never fetches or parses the
> site's HTML pages. Search covers the newest 100 postings; `detail` returns the feed
> summary, not the full description.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Filter the feed by keyword, category, where-from and posting age |
| `detail` | Return one feed entry by slug or posting URL |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. All errors go to **stderr** as `{ "error": "...", "code": "..." }`
with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -c programming --format table
bun run src/cli.ts search -q unity --jobage 14 --format table
bun run src/cli.ts search -q "gameplay -senior" -l anywhere --format table
bun run src/cli.ts detail creature-unity-gameplay-tools-programmer --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords, client-side: all words, `"phrase"`, `-exclude`. |
| `--category` | `-c` | Category slug: `programming`, `design`, `art-animation`, ... |
| `--location` | `-l` | Substring of where-from: `anywhere`, `europe`, `PT`. |
| `--jobage` | | Posted within N days. |
| `--page` | | Page of the filtered list (25 per page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` (default), `table`, `plain`. |

## Development

```bash
bun run typecheck
bun run test      # network-free: a saved feed served from a local server
```

The HTML hygiene helpers at the top of `src/helpers.ts` (`visibleHtml`, `stripInvisible`,
entity decoding) are copied verbatim from community-portals' `linkedin-search` (MIT). See `../url-reference.md` for the feed format and the access
rules.
