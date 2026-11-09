# bulldogjob-cli

Search Polish IT jobs on [bulldogjob.pl](https://bulldogjob.pl) from the command line. Zero runtime
dependencies (plain `bun` + `fetch`); `bun install` only pulls dev types.

```bash
cd .agents/skills/bulldogjob-search/cli && bun install
bun run src/cli.ts search -q "PHP architect" -l Remote --format table
bun run src/cli.ts detail 260906 --format plain
bun run typecheck && bun run test
```

Bulldogjob has no free-text search: the first `-q` word is the server-side skill filter, the rest
match title/tags client-side. Parsing reads the Next.js `__NEXT_DATA__` JSON, not HTML markup, so no
parsing library is needed. See `../SKILL.md` for flags and `../url-reference.md` for endpoints.
Personal use only; keep volume low.
