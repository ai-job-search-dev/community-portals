# editx-cli

Command-line search for [Editx.eu](https://editx.eu), a Belgian IT job board,
through the JSON API behind the site's own job search. Zero runtime
dependencies: plain `bun` and `fetch`.

**Personal use only.** Editx's Terms of Use (section 3.3) list "Use scraping or
similar techniques, to collect content" among things users agree not to do.
Keep volume low and don't use it commercially. See `../SKILL.md`.

## Install

```bash
bun install   # dev types only (typescript, @types/bun)
```

## Usage

```bash
bun run src/cli.ts search -q "python" -l Leuven --format table
bun run src/cli.ts search -q "data engineer" -l Gent --jobage 30 --limit 10
bun run src/cli.ts detail 20750 --format plain
bun run src/cli.ts --help
```

| Command | Flag | Default |
|---|---|---|
| `search` | `--query/-q <text>` | required |
| | `--location/-l <place>` | none (whole board) |
| | `--jobage <days>` | none (no date filter) |
| | `--page <n>` | `1` |
| | `--limit/-n <n>` | `25` (max 50) |
| | `--format json\|table\|plain` | `json` |
| `detail <id\|url>` | `--format json\|plain` | `json` |

Unknown or repeated flags, missing values, numbers that are not plain digits
and stray arguments exit 1 with a JSON error on stderr instead of being
ignored. A value starting with `-` needs the `=` form: `--query=-net`.

## Layout

```
src/cli.ts              argument parsing and validation
src/commands/search.ts  search request, client-side --jobage/--limit, renderers
src/commands/detail.ts  detail request and plain renderer
src/helpers.ts          API client (backoff, 404, redirect refusal), field mapping,
                        HTML cleaning (visibleHtml, cleanHtml) and stripInvisible
```

## Tests

```bash
bun run typecheck
bun test
```

Tests are network-free. CLI tests run the real `src/cli.ts` in a child process
with a preload that blocks `fetch`, or that routes only the two `api.editx.eu`
endpoints to a loopback server serving the saved responses in
`tests/fixtures/` (see `tests/fixtures/README.md`). Retry/backoff tests stub
`fetch` and `setTimeout` and assert the actual delays.
