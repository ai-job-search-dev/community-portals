# Work With Indies URL Reference

Recorded 2026-11-16. The site is built on Webflow.

## Access rules

- `robots.txt` contains only a `Sitemap:` line: nothing is disallowed.
- The [terms](https://www.workwithindies.com/terms) prohibit using the service "(i) to spam,
  phish, pharm, pretext, spider, crawl, or scrape". The site links its RSS feed in its own
  footer ("RSS"), which is the channel this skill uses.
- **This skill fetches only the feed.** It never requests `/categories/<slug>`,
  `/careers/<slug>` or any other HTML page, even though those are public, because parsing
  them would be the scraping the terms forbid.

## Feed (the only endpoint used)

```
GET https://www.workwithindies.com/careers/rss.xml
```

RSS 2.0, the 100 newest postings, newest first. No query parameters, no paging.

Per `<item>`:

| Element | Content | Example |
|---------|---------|---------|
| `title` | Headline: `<Company> is hiring a(n) <Role> to work from <Place>` or `... to join their team in [the] <Place>` | `Creature is hiring a Unity Gameplay & Tools Programmer to work from US/Canada time zones` |
| `link` / `guid` | Posting URL; the slug is the last path segment | `https://www.workwithindies.com/careers/creature-unity-gameplay-tools-programmer` |
| `description` | One-paragraph summary, then `Tags: [Category] [Engagement]` (entity-escaped) | `... Tags: [Programming] [Contract]` |
| `pubDate` | RFC 822 date, midnight UTC | `Wed, 11 Nov 2026 00:00:00 GMT` |
| `media:content` / `media:thumbnail` | Company logo (unused) | |

Tag values seen: categories `Programming`, `Design`, `Art & Animation`, `Audio`, `Writing`,
`Production`, `Marketing & Community`, `Business & Operations`, `QA & CS`; engagements
`Full Time`, `Part Time`, `Contract`, `Freelance`.

## Not used, documented for reference

These public pages exist but are deliberately not fetched (see Access rules):

- `/categories/<slug>`: every open posting in a category, as Webflow `w-dyn-item` cards
  (company, title, where-from; no dates).
- `/careers/<slug>`: the posting page, with a JSON-LD `JobPosting` (its strings contain
  raw control characters, so strict JSON parsers reject it), `applicantLocationRequirements`,
  `validThrough`, the full description in `div.job-description.w-richtext`, and a
  `div.closed-notif` that loses its `w-condition-invisible` class when the job is closed.

If the board's owners ever permit page reads, these are the anchors to start from.
