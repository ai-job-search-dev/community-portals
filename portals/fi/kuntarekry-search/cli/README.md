# kuntarekry-cli

Read-only CLI for [Kuntarekry.fi](https://kuntarekry.fi), the job board of
Finnish municipalities and wellbeing services counties. Zero runtime
dependencies: Bun's `fetch` plus regex parsing of the board's JSON list and
job pages. `bun install` pulls only TypeScript types.

```bash
bun install
bun run src/cli.ts search -q harjoittelija -l Uusimaa --format table
bun run src/cli.ts detail <id> --format plain
bun run typecheck
bun test
```

Tests are network-free: unit tests use the captured fixtures in
`tests/fixtures/`, and CLI tests run the real CLI in a fresh process against a
local server through a fetch preload that refuses every host but the fake
board. The detail fixture is a trimmed copy of a real posting (25.11.2026)
with the contact person's name and address replaced by placeholders.

See `../SKILL.md` for flags and output, and `../url-reference.md` for the
endpoints.
