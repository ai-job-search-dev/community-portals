# Fixtures

Trimmed copies of real Remote Game Jobs responses, captured 2026-11-17 with the CLI's
User-Agent:

- `search-unity.html` - `GET /search?query=unity`: three result cards (logo `<img>` tags
  shortened; card markup otherwise unchanged).
- `feed.rss` - `GET /feed.rss`: the channel header and two items, one matching a card above.
- `detail-skymap.html` - `GET /jobs/skymap-games-multiplayer-engineer-unity-remote-job`:
  the JSON-LD block and the posting body with its facts box; scripts, styles and icons removed,
  and the newsletter form's `authenticity_token` value replaced with `REDACTED`.

Re-capture them if the board changes its markup.
