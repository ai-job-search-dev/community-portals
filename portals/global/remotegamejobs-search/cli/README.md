# remotegamejobs-cli

CLI for searching remote-only games-industry jobs on
[Remote Game Jobs](https://remotegamejobs.com).

**Data source**: the board's public, server-rendered pages (`/search`, category pages,
`/jobs/<slug>`) and its RSS feed (`/feed.rss`, for dates).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is optional
and only pulls dev type definitions.

> **Personal use only.** The board's terms license its content for personal,
> non-commercial use. Keep volume low and don't use this commercially or for bulk
> collection. The CLI never requests `/goto/` (disallowed by robots.txt).

## Commands

| Command | Description |
|---------|-------------|
| `search` | Full-text search and/or one category, filtered by remote scope and age |
| `detail` | Fetch the full posting for one slug or remotegamejobs.com URL |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. All errors go to **stderr** as `{ "error": "...", "code": "..." }`
with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q unity --format table
bun run src/cli.ts search -c programming -l worldwide --format table
bun run src/cli.ts detail skymap-games-multiplayer-engineer-unity-remote-job --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Full-text keywords (all words must match; quotes ignored). |
| `--category` | `-c` | `programming`, `design`, `art-and-animation`, ... |
| `--location` | `-l` | Substring of the remote scope: `worldwide`, `europe`, `canada`. |
| `--jobage` | | Posted within N days (dates from the RSS feed). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` (default), `table`, `plain`. |

There is no `--page`: the board returns every match on one page.

## Development

```bash
bun run typecheck
bun run test      # network-free: saved pages served from a local server
```

The HTML hygiene helpers at the top of `src/helpers.ts` (`visibleHtml`, `stripInvisible`,
entity decoding) are copied verbatim from community-portals' `linkedin-search` (MIT). See `../url-reference.md` for the endpoints and parsing anchors.
