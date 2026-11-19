# justjoin-cli

Zero-dependency `bun` CLI for searching **justjoin.it**, Poland's largest IT job
board. Reads the portal's public, robots-permitted listing pages — no API key, no
login, nothing to install beyond dev types.

## Install

```bash
cd .agents/skills/justjoin-search/cli && bun install
```

`bun install` pulls dev types only (`typescript`, `@types/bun`). The CLI itself has
no runtime dependencies.

## Use

```bash
bun run src/cli.ts search -q "PHP Symfony" --format table
bun run src/cli.ts search -q "software architect" --workplace remote --experience senior
bun run src/cli.ts search -c php --employment-type b2b --with-salary --jobage 14
bun run src/cli.ts detail <slug> --format plain
bun run src/cli.ts --help
```

Full flag reference: `../SKILL.md`. Endpoints and parsing anchors:
`../url-reference.md`.

## Design

- **No API host.** `api.justjoin.it` is `Disallow: /` in robots.txt, so this CLI
  reads the server-rendered `/job-offers/` pages instead. That is also why
  pagination is unsupported — `--page 2` exits `1` rather than silently
  re-returning page 1.
- **No class-name parsing.** justjoin's markup uses build-hashed MUI class names
  that change every deploy. The CLI reads the Next.js RSC data payload streamed
  into the page, so results are structured JSON, not scraped text.
- **Chunked, fault-tolerant parsing.** Each offer object is located and parsed
  independently; one malformed offer cannot break a whole page of results.
- **Flags are never silently ignored.** An unknown flag, an out-of-vocabulary
  value, or an unsupported `--page` exits `1` with a JSON error on stderr,
  because a discarded filter changes what the search returns.

## Test

```bash
bun run test        # offline suite, no network
bun run typecheck
```

The suite never touches the network. `tests/fixtures/fetch-fixture.ts` is preloaded
into the CLI child process and serves a canned justjoin.it `/job-offers` page; any
request to another host or path throws, so a stray request fails the test.
`tests/parsing.test.ts` covers the parsers (including UTF-8 byte-length RSC rows),
`tests/cli-flag-validation.test.ts` and `tests/output.test.ts` run the CLI end to end
against the fixture, and `tests/retry-backoff.test.ts` covers retry behaviour.
Because nothing is live, a change in justjoin.it's rendering will not fail the suite
— re-check `../url-reference.md` against the real site when it misbehaves.
