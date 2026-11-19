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
- **Dates are free, with a bounded fallback.** Listing cards carry no
  publication date, but the search page's embedded state does, so `--dates` and
  `--jobage` read it at no extra cost. Only results it leaves undated fall back to
  one detail request each, at most 30 per search, so no `--limit` is required.
- **Flags are never silently ignored.** An unknown flag or an out-of-vocabulary
  value exits `1` with a JSON error on stderr.

## Test

```bash
bun run test        # 97 tests, all offline
bun run typecheck
```

Every suite runs offline: in-process tests mock `fetch`, and every CLI child
process spawned through `runCLI` (`tests/helpers.ts`) preloads
`tests/fixtures/no-network.ts`, which makes any real request throw.
`tests/parsing.test.ts` covers the parsers against inline HTML — including the
regression cases that bit during development: the icon-prefixed company/city
fields, the `1.5M` abbreviation, and the similar-offers salary and city leaks.
`tests/output.test.ts` checks the `search`/`detail` output contract against a
mocked site, `tests/cli-flag-validation.test.ts` the flag rules,
`tests/retry-backoff.test.ts` retries, and `tests/sweep.test.ts` page-state dates
and `--all`.
