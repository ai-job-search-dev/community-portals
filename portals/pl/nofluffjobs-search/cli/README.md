# nofluffjobs-cli

Zero-dependency `bun` CLI for searching **nofluffjobs.com**, the Polish IT job
board with mandatory salary disclosure. Reads the portal's public,
robots-permitted server-rendered pages — no API key, no login, nothing to install
beyond dev types.

## Install

```bash
cd .agents/skills/nofluffjobs-search/cli && bun install
```

`bun install` pulls dev types only (`typescript`, `@types/bun`). The CLI itself has
no runtime dependencies.

## Use

```bash
bun run src/cli.ts search -q "PHP Symfony" --format table
bun run src/cli.ts search -q symfony -l Remote --seniority senior
bun run src/cli.ts search -c backend -l Remote --limit 10 --dates
bun run src/cli.ts detail <slug> --format plain
bun run src/cli.ts --help
```

Full flag reference: `../SKILL.md`. Endpoints and parsing anchors:
`../url-reference.md`.

## Design

- **No API host.** `robots.txt` disallows `/api/` and `/posting/`, so this CLI
  reads the server-rendered `/pl` and `/job/` pages instead.
- **`data-cy` anchors, not class names.** The markup's Tailwind and `_ngcontent`
  classes change every build; Angular's `data-cy` test attributes and component
  tag names do not.
- **Chunked, fault-tolerant parsing.** Each card is sliced and parsed
  independently; one malformed card cannot break a whole page of results.
- **Dates cost requests, and that cost is visible.** Listing cards carry no
  publication date, so `--dates`/`--jobage` fetch one detail page per result and
  refuse to run without `--limit ≤ 30`, rather than silently fanning out.
- **Flags are never silently ignored.** An unknown flag, an out-of-vocabulary
  value, or an unbounded date lookup exits `1` with a JSON error on stderr.

## Test

```bash
bun run test        # 47 tests: offline parsing + live smoke tests
bun run typecheck
```

`tests/parsing.test.ts` runs offline against fixtures — including the regression
cases that bit during development: the icon-prefixed company/city fields, the
`1.5M` abbreviation, and the similar-offers salary leak.
`tests/search.test.ts` and `tests/cli-flag-validation.test.ts` make a handful of
real requests, so they fail loudly if the portal's rendering changes.
