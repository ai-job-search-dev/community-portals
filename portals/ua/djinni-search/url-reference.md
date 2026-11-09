# Djinni URL Reference

Public, unauthenticated pages on `djinni.co` used by this skill. Verified live on 2026-10-30.

## Access

- `robots.txt` (`User-agent: *`) disallows only `/jobs2`, `/q`, `/developers`, `/free-jobs` and `/set_lang`. `/jobs/` and posting pages are allowed.
- The terms page (`/pricing`, linked as "Умови користування") bans employers from harvesting candidates' contacts or personal data by parsing; it says nothing about reading public vacancy listings.
- No login, API key or bot wall: plain `fetch` with an honest User-Agent (`Mozilla/5.0 (compatible; djinni-cli/1.0)`) gets HTTP 200.
- Pages render in Ukrainian for anonymous visitors whatever `Accept-Language` says. `/set_lang` would switch it, but robots.txt disallows it, so the CLI parses Ukrainian labels.

## Search

```
GET https://djinni.co/jobs/?<params>
```

Query params (all optional; no params = the whole board, newest first):

| Param | Meaning | Values |
|-------|---------|--------|
| `all_keywords` | Keyword query | free text |
| `search_type` | How `all_keywords` matches | `basic-search` (titles/tags) · `full-text` (whole description) · `title-only` |
| `primary_keyword` | Category | exact Djinni name, e.g. `React.js`, `JavaScript`, `Fullstack`, `Node.js`. **Unknown names are silently ignored** (`primary_keyword=React` returned all 6129 postings), hence the CLI's client-side list |
| `employment` | Work format | `remote` · `parttime` · `office`. `remote` also matches roles where remote is one option among office/hybrid |
| `region` | Countries the posting accepts candidates from | `worldwide` · `UKR` · `eu` · `other` |
| `location` | Office city | `kyiv`, `lviv`, `kharkiv`, `odesa`, `dnipro`, … (22 slugs, listed in `CITIES`) |
| `salary` | Monthly salary filter, USD | integer, e.g. `3000` |
| `editorial` | Editorial flags | `has_public_salary` · `ukrainian_product` · `miltech` · `reservation` |
| `page` | Pagination | 1-indexed, 15 results per page |

Also on the filter form but not wired into the CLI: `exp_level` (`no_exp`, `1y` … `10y`), `english_level`, `company_type`, `any_of_keywords`, `exclude_keywords`, `show_stale`.

There is **no posting-age parameter**; `--jobage` filters client-side on `datePosted`.

### Response structure

Server-rendered HTML. Two sources, joined by job id:

1. **Cards**, one per posting, inside `<main id="jobs_main">`:
   - Anchor: `<div id="job-item-<id>" class="job-item ...">` (the CLI splits on this)
   - Link: `<a href="/jobs/<id>-<slug>/" class="job_item__header-link ...">`
   - Inside `<header>`: title `<h2 class="job-item__position ...">`, company `<span class="small text-gray-800 opacity-75 font-weight-500">`, salary either `<strong class="text-success ...">до $6000</strong>` (public) or `<span class="text-body-tertiary fw-medium" title="Рівень зарплати...">$$$</span>` (relative tier)
   - Meta row after `</header>`: `<span class="location-text">` (candidate countries), and `<span class="text-nowrap">` labels such as `Тільки віддалено`, `4 роки досвіду`, `Англійська - B1`, the domain. Multi-format roles carry no work-format label here.
   - Teaser: `<div id="job-description-<id>">` (not used)
   - Result total: `<span class="fs-1 fw-bold text-muted">273</span>` right after the page `<h1>`
2. **JSON-LD**: one `<script type="application/ld+json">` holding an array of schema.org `JobPosting`, same order as the cards. Fields used: `identifier` (number), `title`, `url`, `hiringOrganization.name`, `datePosted` (naive local ISO, e.g. `2026-10-30T14:43:11.372863`), `validThrough` (+30 days), `employmentType` (`FULL_TIME`, `PART_TIME`, …), `jobLocationType` (`TELECOMMUTE` only on remote-only roles), `jobLocation` (Place or list of Places with `addressLocality` city arrays), `experienceRequirements.monthsOfExperience`, `category`.

## Detail

```
GET https://djinni.co/jobs/<id>-<slug>/
```

- `/jobs/<id>/` without a slug is a **404**; any slug (`/jobs/<id>-x/`) **301-redirects** to the canonical one. The CLI fetches `/jobs/<id>-x/` for a bare id.
- Title `<h1 class="m-0 mb-1 fs-2">`; company `<a href="https://djinni.co/jobs/company-<slug>/" class="text-secondary fw-medium">`; salary in the header like the cards.
- Description: `<div class="mb-4 job-post__description">` (rendered HTML; the CLI keeps paragraph and list breaks). The JSON-LD `description` is plain text with newlines and is the fallback.
- Sidebar `<aside>`: `<strong>` labels for experience (`Виключно від 4 років досвіду`), work format (`Тільки віддалено` / `Офіс, Віддалена робота, Гібридний формат роботи`), `<span class="location-text">` + `Країни, де розглядаємо кандидатів` (candidate countries), languages (`Англійська B1 – Середній`, `Українська Носій мови`), category and skill tags.
- One JSON-LD `JobPosting` object (not an array), same fields as on the search page.

## RSS (not used)

`https://djinni.co/jobs/rss/` returns the latest 100 postings but **ignores the search filters** (`?primary_keyword=React.js` still returned every category) and has no company or location fields. Its `<channel>` `<category>` list is where `CATEGORIES` comes from: refresh it from there if Djinni adds categories.
