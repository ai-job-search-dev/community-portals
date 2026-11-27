# Remote Game Jobs URL Reference

Recorded 2026-11-17. A Rails site with server-rendered pages.

## Access rules

- `robots.txt`: `User-agent: *` / `Disallow: /goto/` (plus a sitemap). The skill never
  requests `/goto/`.
- [Terms](https://remotegamejobs.com/terms), section 2: content is provided "for your
  information and personal use only", with a limited license "solely for your personal,
  non-commercial use". No clause on automated access. Hence the personal-use note in
  SKILL.md.

## Search

```
GET https://remotegamejobs.com/search?query=<text>
```

| Param | Meaning |
|-------|---------|
| `query` | Full-text keywords; all words must match. Quotes ignored, `OR` is a plain word, `-term` is a plain term. An empty value lists every live posting. |

No paging: every match comes back on one page (the board holds a few dozen live postings).
`page=` is ignored. Unknown parameter names (e.g. `q`) are ignored too and return every posting.

## Category pages

```
GET https://remotegamejobs.com/remote-game-<category>-jobs
```

Categories: `art-and-animation`, `business-analysis`, `community-management`, `design`,
`music-sound-design`, `production`, `programming`, `quality-assurance`, `sales-marketing`,
`voice-acting`, `writing`. Same card markup as search.

### Card anchors (search and category pages)

One `<a title="<Company> is hiring <Role> (Remote Job)" class="card" href="https://remotegamejobs.com/jobs/<slug>">` per posting:

- title: `<h3>Role</h3>` (followed by an optional `<span class="pxb">New</span>`)
- company: `<div class="sub"><b>Company</b></div>`
- remote scope: `<span class="scope"><span>Worldwide</span></span>`
- category: `<span class="chip chip-o">Programming</span>`
- engagement and level: `<span class="chip">Full-Time</span> <span class="chip">Mid-Level</span>`
- salary: `<div class="side">...</div>` ("Salary not listed" when absent)

Cards carry **no date**.

## Feed (dates)

```
GET https://remotegamejobs.com/feed.rss
```

RSS 2.0, the newest ~30 postings (about six weeks): `title`, `link` (posting URL),
`pubDate` (exact), `description` (summary). The CLI uses it only to date cards by slug.

## Detail

```
GET https://remotegamejobs.com/jobs/<slug>
```

- JSON-LD `JobPosting`: `datePosted`, `validThrough`, `employmentType`,
  `hiringOrganization.name`, `jobLocationType: TELECOMMUTE`,
  `applicantLocationRequirements` (list of `Country`), `baseSalary`, `identifier.value`.
- `<h1>` title; `<div class="byline">` with company link then category link.
- Facts box: `<span class="px">Remote scope</span><span class="scope"><span>...</span></span>`,
  `<span class="px">Type · level</span><b>Full-Time · Mid-Level</b>`,
  `<span class="px">Salary</span><span class="sal">...</span>`,
  `<span class="px">Skills</span>...` ("Not listed" when empty).
- Description: `<div class="trix-content">` (nested; the outermost one is read).
- Apply: `href="/goto/<slug>"` (robots-disallowed; printed, never fetched).
- A removed posting returns 404.
