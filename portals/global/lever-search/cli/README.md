# lever-cli

Reads company job boards hosted on Lever through the public Postings API
(`api.lever.co/v0/postings/<slug>`). Zero runtime dependencies: `bun install`
only pulls dev types.

```bash
bun run src/cli.ts search -b leverdemo -q "engineer" --format table
bun run src/cli.ts detail "https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b" --format plain
bun run test        # offline: CLI runs against tests/fixtures/, network blocked
bun run typecheck
```

See `../SKILL.md` for flags and `../url-reference.md` for the API fields.
