# ats-cli

Unified CLI for querying direct company ATS job boards (Greenhouse, Lever, Ashby) defined in the skill's `watchlist.json` (override with `--watchlist <path>`).

## Commands

```bash
bun run src/cli.ts search [flags]
bun run src/cli.ts detail <id|url> [--format json|plain]
```

## Features

- Multi-provider support: Greenhouse, Lever, Ashby
- Direct, unauthenticated API fetching
- Normalized canonical job schema
- Watchlist configuration in `watchlist.json` at the skill root
