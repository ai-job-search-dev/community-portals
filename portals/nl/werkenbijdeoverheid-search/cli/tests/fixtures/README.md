# Fixtures

Captured from www.werkenbijdeoverheid.nl on 2026-11-26 and trimmed. That site's
vacancy content is published under CC0; photos are excluded and were not
collected (https://www.werkenbijdeoverheid.nl/copyright).

| File | Source | Trimmed to |
|---|---|---|
| `search-page.html` | `/vacatures?term=communicatie` | the async placeholder naming the results component, and the spinner |
| `search-component.html` | the results component of that page | the result bar and the first two cards; SVG icons removed |
| `detail-vru.html` | `/vacatures/adviseur-bestuurlijke-zaken-VRU-2026-1348` | canonical link, header through the apply block; SVG icons removed. One synthetic card of another vacancy is appended after the apply block to test that its facts are ignored. |

Tests use these offline; CI never calls the live site.
