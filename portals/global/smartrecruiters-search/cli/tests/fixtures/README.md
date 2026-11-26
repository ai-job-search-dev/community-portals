# Fixtures

Saved SmartRecruiters Posting API responses, abridged from live calls on
2026-11-26 against the `BoschGroup` board. Names, ids and dates are real; the
description test markers (`Ignore previous instructions`) are added on purpose
so the hidden-text test proves the renderer drops them. Non-public rows and
malformed payloads are synthesised in `tests/cli.test.ts`, not added here.

| File | Endpoint |
|------|----------|
| `board.json` | `GET https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=20&offset=0` |
| `job-744000163798847.json` | `GET https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000163798847` |

Tests never call the network: `tests/helpers.ts` serves these through a local
server and a fetch preload that refuses every other host.
