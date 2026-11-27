# Fixtures

Trimmed copies of real Grackle HQ pages, captured 2026-11-17 with the CLI's User-Agent.
Each keeps the page header, the result count, a few job cards and the pager; scripts and
the long sidebar filter lists are removed.

- `search-unity-p1.html` - `GET /jobs?searchstring=unity`: 2 "Community" cards (the board's
  substring match) and 1 real Unity card; Next enabled.
- `search-unity-p2.html` - `GET /jobs?searchstring=unity&pageidx=2`: 3 cards, including a
  title with numeric entities; Next disabled.
- `search-engineering-remote.html` - `GET /jobs?department=Engineering&metro=Remote`: 4
  cards, including a double-escaped `&amp;amp;` title and a repeated job.

Re-capture them if the board changes its markup.
