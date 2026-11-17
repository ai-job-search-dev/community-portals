# Fixtures

- `feed.xml` - a trimmed copy of `GET https://www.workwithindies.com/careers/rss.xml`,
  captured 2026-11-16 with the CLI's User-Agent: the channel header and four items (design,
  art, and two programming postings, all with "to work from" headlines; the "to join their
  team in" form is covered by `splitHeadline` tests in `parsing.test.ts`). Item markup is
  unchanged. Re-capture it if the feed format changes.
