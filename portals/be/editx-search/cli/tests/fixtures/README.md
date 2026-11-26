# Fixtures

Saved Editx API responses, served over loopback by `tests/helpers.ts` so the
CLI tests never touch the network. Captured on 2026-11-25 with `curl` and the
CLI's User-Agent `Mozilla/5.0 (compatible; editx-search-cli/1.0)`.

| File | Request |
|---|---|
| `search-leuven-python.json` | `GET https://api.editx.eu/api/editx/jobs?keyword=python&location=Leuven&count=3` |
| `detail-20750.json` | `GET https://api.editx.eu/api/editx/job/20750` (the first result above) |
| `search-past-end.json` | `GET https://api.editx.eu/api/editx/jobs?keyword=python&location=Leuven&page=9` (verbatim) |

SHA-256 of the raw responses before scrubbing:

- search: `f04b798757b606a60701dc300d940615c826d6acdd686f4fce9375b24ad548a7`
- detail: `70f806bc9a14aa9c34220b1e83ac8dacb84f065e26aeb2e4d0fefd6719285519`
- past end: `4264740273f294db4832e1b00d7ee98832fa0abf9deac7b9add3b6dc449a7a3f` (unchanged)

## Scrubbing

The search and detail files were reformatted as indented JSON and scrubbed:

- **Removed entirely:** every `recruiter` object (a named person: first name,
  abbreviated last name, photo URLs, LinkedIn URL), and every `logo`, `banner`,
  `picture` and `linkedin` field.
- **Replaced in free text** (`role`, `profile`, `proposal`, `shortDescription`,
  `description`): email addresses with `info@example.com` and phone numbers
  with `+32 000 00 00 00` (none were present in this capture).
- **Removed from URLs:** `utm_*` tracking parameters. They were present: the
  detail response's `applicationAction` carried `utm_source`, `utm_medium` and
  `utm_campaign`. The CLI strips the same parameters from `apply_url` at
  runtime (covered by `parsing.test.ts`).

Everything else is as Editx returned it: public job postings and the employing
company's public details. No tokens, cookies or credentials are involved; the
API is unauthenticated.
