# Werken bij de Overheid URL reference

Public, unauthenticated HTML endpoints. Base URL: `https://www.werkenbijdeoverheid.nl`.
Checked on 2026-11-26. robots.txt allows the vacancy pages; content is CC0
(`/copyright`), photos excluded.

## Search

```text
GET /vacatures?term=<keywords>[&pagina=<n>][&sinds=<window>]
GET /vacatures?_hn:type=component-rendering&_hn:ref=<ref>&term=<keywords>[...]
```

| Parameter | CLI flag | Meaning |
|---|---|---|
| `term` | `--query` | Keywords; all must match, any order; quotes ignored; `OR` returns nothing |
| `pagina` | `--page` | 1-indexed page, 20 cards per page; omitted for page 1 |
| `sinds` | `--jobage <days>` | Numeric age; maps 1→`gisteren`, 2–3→`3d`, 4–5→`5d`, 6–7→`7d`, 8–10→`10d`, 11–31→`1m`; above 31 omits `sinds` |
| `_hn:type`, `_hn:ref` | internal | The results component; see below |

The search page itself has no results. It contains hidden placeholders
`<div style="display:none;" id="/vacatures?_hn:type=component-rendering&_hn:ref=...">`;
the last one before `id="vacancy-spinner"` is the results component. Its `_hn:ref`
changes between deployments, so it is read from the page on every search.

Unknown parameters (tested: `sortering`) make the component return zero
results. The postcode and distance filters in the page's filter panel are set
by JavaScript and have no URL parameter that was found.

### Results component

| Field | Anchor |
|---|---|
| Total | `.vacancy-result-bar__totals-badge` (fallback `[role="status"]`) |
| Card | split on `<li class="... vacancy-list__item ...">` |
| ID and URL | `.vacancy__title a[href^="/vacatures/"]`; the slug is the ID |
| Title | text of that link |
| Employer | `.vacancy__employer` |
| Place, hours, salary, level, contract | `title="Locatie"`, `"Uren per week"`, `"Salaris"`, `"Niveau"`, `"Arbeidsovereenkomst"`, each followed by `.job-short-info__value` |
| Closing date | `.vacancy-publication-end` ("Solliciteer voor 21 december 2026") |
| Posting date | `.job-short-info__top` ("Plaatsingsdatum: 25 november 2026") |
| Summary | `.vacancy__description` |

## Detail

```text
GET /vacatures/<slug>
```

No JSON-LD (unlike werkenvoornederland.nl, which shares the platform).

| Field | Anchor |
|---|---|
| ID | `<link rel="canonical" href=".../vacatures/<slug>">` |
| Title | `h1.job-header__header` |
| Employer | `.job-header__title__link` |
| Facts | labelled `job-short-info` values as above, plus `"Vakgebied"`, `"Contractduur"`, `"Salarisomschrijving"`; read between the header and the first `job-contact`/`apply-job` block (cards of other vacancies follow it) |
| Closing date | `.vacancy-publication-end` |
| Apply link | `applyExternClick('<url>')` |
| Text | `<section id="...">` for `dit_ga_je_doen_anchor`, `dit_krijg_je_anchor`, `dit_bieden_wij_nog_meer_anchor`, `dit_vragen_wij_anchor`, `hier_kom_je_te_werken_anchor`, `bijzonderheden_anchor` |

A missing vacancy returns 404.
