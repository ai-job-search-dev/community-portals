# Fixtures

Synthetic responses shaped like the Greenhouse Job Board API (`boards-api.greenhouse.io/v1/boards/{board}/jobs`
and `.../jobs/{id}?pay_transparency=true`); field names follow `../../../url-reference.md`. The board
("acme", Acme Robotics) and every posting are made up. `content` is entity-escaped HTML, as the API
sends it, and carries a hidden element with a quoted `>` so the hidden-text tests cover that case.
