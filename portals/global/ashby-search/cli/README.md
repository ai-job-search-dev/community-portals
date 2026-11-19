# ashby-cli

Reads company job boards hosted on Ashby through the public Job Postings API
(`api.ashbyhq.com/posting-api`). Zero runtime dependencies: `bun install` only pulls dev types.

```bash
bun run src/cli.ts search -b linear,ramp,notion -q "engineer" --format table
bun run src/cli.ts detail https://jobs.ashbyhq.com/ramp/6e717b06-6613-42ad-a1ee-f852a305fa37 --format plain
bun run test        # offline: CLI runs against tests/fixtures/, network blocked
bun run typecheck
```

See `../SKILL.md` for flags and `../url-reference.md` for the API fields.
