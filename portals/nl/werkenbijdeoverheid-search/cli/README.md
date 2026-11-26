# werkenbijdeoverheid-cli

CLI for vacancies on [Werken bij de Overheid](https://www.werkenbijdeoverheid.nl),
the Dutch government-wide job board (national government, municipalities,
provinces, water boards and other public employers).

**Data source**: the site's server-rendered search results and vacancy pages.
**Authentication**: none.
**Dependencies**: none at runtime (plain `bun` + `fetch`). `bun install` only pulls dev types.
**Licence of the data**: CC0 (photos excluded, not collected).

Search follows `werkenvoornederland-search` by Fabian Schreuder
(github.com/Fabian-Schreuder/ai-job-search-nl, MIT): both sites run on the same
platform. Detail pages here have no JSON-LD and are parsed from their HTML.

## Commands

| Command | Description |
|---|---|
| `search` | Search vacancies (`--query` required) |
| `detail` | Full text and facts of one vacancy |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
Errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Examples

```bash
bun run src/cli.ts search -q communicatie --jobage 7 --format table
bun run src/cli.ts search -q beleidsadviseur -l utrecht --format plain
bun run src/cli.ts detail adviseur-bestuurlijke-zaken-VRU-2026-1348 --format plain
```

## Development

```bash
bun install
bun run typecheck
bun test        # offline: fixtures in tests/fixtures, network blocked
```
