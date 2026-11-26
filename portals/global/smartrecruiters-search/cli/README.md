# smartrecruiters-cli

Reads company job boards hosted on SmartRecruiters through its public Posting
API on `api.smartrecruiters.com`. Zero runtime dependencies: `bun install` only
pulls dev types.

```bash
bun run src/cli.ts search -b BoschGroup -q "software engineer" --format table
bun run src/cli.ts search -b BoschGroup --city Berlin --format table
bun run src/cli.ts search -b BoschGroup --remote remote,hybrid --format table
bun run src/cli.ts detail https://jobs.smartrecruiters.com/BoschGroup/744000163798847 --format plain
bun run test        # offline: CLI runs against tests/fixtures/, network blocked
bun run typecheck
```

`--location` first tries an exact city filter; if the board has no such city it
filters only the 20-row page fetched and prints a `PAGE_SCOPED_FILTER` warning.
With `--city` set, that attempt is skipped and `--location` is always page-scoped.
`--jobage` is sent as `releasedAfter` and covers the whole board. `--remote`
maps to the server-side `locationType` filter (`remote`/`hybrid`/`onsite`, bare
means remote, comma is OR). Use `--city`, `--country` or `--region` for an
explicit board-wide location filter.

See `../SKILL.md` for flags and `../url-reference.md` for the endpoints and fields.
