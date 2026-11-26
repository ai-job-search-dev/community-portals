# Fixtures

Synthetic responses shaped like Lever's public Postings API
(`api.lever.co/v0/postings/{board}?mode=json&limit=100&skip=0` and
`.../{board}/{uuid}?mode=json`); field names follow `../../../url-reference.md`.
The board ("acme", Acme Robotics) and every posting are made up. The detail
fixture carries a hidden element with a quoted `>` so the hidden-text test
covers that case, plus the separate `lists` and `additional` fields Lever uses
for the requirements and trailing copy.
