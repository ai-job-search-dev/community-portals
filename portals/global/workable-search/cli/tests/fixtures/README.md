# Fixtures

Synthetic responses shaped like Workable's documented public jobs endpoint
(`https://www.workable.com/api/accounts/{slug}`, which redirects to
`/api/v1/widget/accounts/{slug}`) and the account job endpoint
(`/api/v1/accounts/{slug}/jobs/{shortcode}`); field names follow
`../../../url-reference.md`. The board ("acme", Acme Robotics) and every posting are
made up. The board fixture lists one posting twice — once per location, as the widget
does for multi-location roles — and one title carries a zero-width space so the
sanitizer tests cover it.
