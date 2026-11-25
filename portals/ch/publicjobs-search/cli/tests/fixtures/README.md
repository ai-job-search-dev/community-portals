# Fixtures

All fixtures are trimmed excerpts of live public responses, captured on 2026-11-25 with
the CLI's User-Agent during the `/add-portal` reconnaissance.

| File | Source | Trimmed to |
|------|--------|------------|
| `sitemap-excerpt.xml` | `publicjobs.ch/sitemap.xml` | the `<urlset>` header, one blog entry, one `/fr/` entry and 8 job entries |
| `detail-168023.json` | `publicjobs.ch/jobs/schwyz/informatik-it/168023-.../__data.json?x-sveltekit-invalidated=01` | decoded, reduced to the job fields the parser reads, re-encoded as devalue. The description is cut before the benefits section, and the contact person's name is replaced by `Max Muster` (e-mail, phone and social links removed) |
| `redirect-168023.json` | `publicjobs.ch/jobs/x/x/168023/__data.json?x-sveltekit-invalidated=01` | unchanged |
| `expired.json` | an expired-posting response | the error node's `message` and `kind` only |

Nothing in the test suite regenerates these files or contacts the site.
