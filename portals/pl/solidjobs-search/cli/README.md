# solidjobs-cli

A command-line tool for searching job offers on [SOLID.Jobs](https://solid.jobs)
through the portal's official public REST API. It needs no authentication and
has **zero runtime dependencies**: just `bun`.

```bash
bun install          # dev types only (typescript, @types/bun)
bun run src/cli.ts search -q "php" --experience Senior --format table
bun run src/cli.ts detail <code> --format plain
bun run typecheck
bun run test         # offline parser tests + a live smoke test
```

- `search` calls `GET /public-api/offers/{division}` with `search.*` filters, sorted newest first.
- `detail` reads the schema.org `JobPosting` JSON-LD on the offer page, because the API has no single-offer endpoint.

See `../SKILL.md` for flags and examples, and `../url-reference.md` for the
endpoint and parameter reference.
