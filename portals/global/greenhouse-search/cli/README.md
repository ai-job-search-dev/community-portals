# greenhouse-cli

Reads company job boards hosted on Greenhouse through the public Job Board API
(`boards-api.greenhouse.io`). Zero runtime dependencies: `bun install` only pulls dev types.

```bash
bun run src/cli.ts search -b gitlab -q "engineer" --format table
bun run src/cli.ts detail https://job-boards.greenhouse.io/gitlab/jobs/8926445002 --format plain
bun run test        # offline: CLI runs against tests/fixtures/, network blocked
bun run typecheck
```

See `../SKILL.md` for flags and `../url-reference.md` for the API fields.
