# Apify Actor fixtures

Two captured Apify API responses (not fully verbatim: each record's
`description` is truncated to 600 characters), served over loopback by the CLI
tests so the real request building and response reading run with no network.

- `run-succeeded.json` — the response to the Actor-run start request, a run that
  finished with `SUCCEEDED`. Data: run `Ve1rROaIe3i1NgRWS`, dataset `jPV8SE3dHqcuO2M3C`.
- `dataset-items.json` — three records from that run's dataset, read with
  `GET /v2/datasets/jPV8SE3dHqcuO2M3C/items?clean=true`. The `description`
  field is truncated to 600 characters on every record; every other field is as
  the Actor returned it.

Source: the Actor `krammer/google-jobs-scraper`, run `Ve1rROaIe3i1NgRWS`, captured
2026-11-27 UTC (run start `2026-11-27T05:19:12.049Z`).

| File | SHA-256 |
|------|---------|
| `run-succeeded.json` | `f40b6f7f730023813712a5737e045c258fd836a01069d351b4b5afeb0ee85a4f` |
| `dataset-items.json` | `1fe8c2e61fda0c012574d6a9a530f1aa0076b9902ce1ee9f5d3878df712aa9a6` |

The tests never regenerate these files and never contact `api.apify.com`. The
child CLI runs behind `tests/no-network.ts`, which lets only loopback through.
