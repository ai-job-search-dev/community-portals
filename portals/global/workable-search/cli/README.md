# workable-cli

Reads company job boards hosted on Workable through its documented public jobs
endpoint (`www.workable.com/api/accounts/<slug>`, which redirects to the widget
endpoint) and the account job endpoint. Zero runtime dependencies: `bun install`
only pulls dev types.

```bash
bun run src/cli.ts search -b digitalgenius -q "engineer" --format table
bun run src/cli.ts detail https://apply.workable.com/digitalgenius/j/801183DB79 --format plain
bun run test        # offline: CLI runs against tests/fixtures/, network blocked
bun run typecheck
```

See `../SKILL.md` for flags and `../url-reference.md` for the endpoints and fields.
