# icims-cli

Reads employer job portals hosted on iCIMS (`<portal>.icims.com`) from their
public HTML. Zero runtime dependencies: `bun install` only pulls dev types.

```bash
bun run src/cli.ts search -p careers-usu -q "engineer" --format table
bun run src/cli.ts detail "https://careers-usu.icims.com/jobs/11021/biology-teaching-assistant/job" --format plain
bun run test        # offline: CLI runs against tests/fixtures/, network blocked
bun run typecheck
```

See `../SKILL.md` for flags and `../url-reference.md` for the page anchors and
query parameters.
