# Fixtures

Synthetic responses shaped like Ashby's public Job Postings API
(`api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true`) and the public board page
(`jobs.ashbyhq.com/{board}`, read for `window.__appData.organization.name`); field names follow
`../../../url-reference.md`. The board ("acme", Acme Robotics) and every posting are made up. One
description carries a hidden element with a quoted `>` so the hidden-text tests cover that case, and
one job has `isListed: false`.
