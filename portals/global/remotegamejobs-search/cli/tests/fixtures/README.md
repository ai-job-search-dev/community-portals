# Fixtures

Trimmed copies of real Remote Game Jobs responses, captured 2026-11-17 with the CLI's
User-Agent:

The board's terms license its content for personal use, so posting text is kept to short
excerpts: enough for the parser tests, not a copy of the posting.

- `search-unity.html` - `GET /search?query=unity`: three result cards (logo `<img>` tags
  shortened; card markup otherwise unchanged).
- `category-programming.html` - derived from `search-unity.html` for the intersection test:
  its first card plus one invented card (`Example Studio`, not a real posting) that the
  search page lacks.
- `search-empty.html` - derived from `search-unity.html` with every card removed (a real
  "no matches" page shape).
- `feed.rss` - `GET /feed.rss`: the channel header and two items, one matching a card above;
  the long item description is cut to its first ~300 characters.
- `detail-skymap.html` - `GET /jobs/skymap-games-multiplayer-engineer-unity-remote-job`:
  the JSON-LD block and the posting body with its facts box, both cut after the first
  responsibilities list, and the studio blurb cut to one paragraph; scripts, styles and
  icons removed, and the newsletter form's `authenticity_token` value replaced with
  `REDACTED`.

Re-capture them if the board changes its markup.
