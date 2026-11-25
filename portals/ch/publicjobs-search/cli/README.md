# publicjobs-cli

CLI for [publicjobs.ch](https://publicjobs.ch), the Swiss job board for cantons,
municipalities, public schools, hospitals and non-profits.

**Data sources**: `sitemap.xml` for search, the posting's SvelteKit `__data.json` for
detail. See `../url-reference.md`.
**Authentication**: none.
**Dependencies**: none (plain `bun` + `fetch` + regex parsing and a small devalue decoder).
`bun install` only pulls dev types.

## Installation

```bash
cd .agents/skills/publicjobs-search/cli
bun install   # optional; only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Open postings from the sitemap, filtered client-side by `--query`, `--location`, `--category` |
| `detail` | Full posting for one numeric id from `search` or a publicjobs.ch posting URL |

```bash
bun run src/cli.ts search -q statistik --format table
bun run src/cli.ts search -c informatik -l SZ
bun run src/cli.ts detail 168023 --format plain
bun run src/cli.ts --help
```

`--query` matches the title slug in the posting URL: every word must appear (umlaut- and
case-insensitive), and "quotes" make a phrase. Search results carry no employer and no date,
because the sitemap has neither. There's no `--jobage`, and passing it is an error. The
sitemap is cached for 30 minutes (`PUBLICJOBS_CACHE_TTL` in seconds, 0 disables;
`PUBLICJOBS_CACHE_DIR`).

Errors are `{ "error", "code" }` on stderr with exit 1.

## Development

```bash
bun run typecheck   # tsc --noEmit
bun run test        # network-free: fixtures in tests/fixtures, fetch replaced per test
```

No checked-in test touches the network. `tests/no-network.ts` makes `fetch` throw, and the
CLI-level tests run the real CLI in a child process whose `fetch` serves only the fixture
URLs listed in `tests/routes.ts`. Any other URL fails the test.
