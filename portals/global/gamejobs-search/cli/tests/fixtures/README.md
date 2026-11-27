# Fixtures

Trimmed copies of real GameJobs.co responses, captured 2026-11-16 with the CLI's own
User-Agent, used by the network-free tests:

- `search-unity.html` - `GET https://gamejobs.co/search?q=unity`: the result summary,
  the dismissible banner (which must not parse as a job) and three job cards, one of
  them with the location "Remote".
- `detail-old-skull.html` - `GET https://gamejobs.co/Gameplay-Programmer-Senior-Unity-at-Old-Skull-Games-2652`:
  the JSON-LD `JobPosting` block and the `<article>` with the description (in French,
  as posted).

Navigation, styles and scripts were removed; the markup of the parts the parser reads is
unchanged. Re-capture both files if the board changes its markup.
