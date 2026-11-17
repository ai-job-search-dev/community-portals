# gracklehq-search - endpoint reference

Recorded 2026-11-17 from live responses. Server-rendered ASP.NET pages (Bootstrap 4,
jQuery); no JSON API. `robots.txt` returns 404. No terms-of-use page; `/FAQ` and
`/Privacy` exist. User-Agent: `Mozilla/5.0 (compatible; gracklehq-cli/1.0)`.

## Search: `GET https://gracklehq.com/jobs`

| Parameter | Meaning |
|-----------|---------|
| `searchstring` | Case-insensitive contiguous substring of the **title**. Quotes are literal (`"unity developer"` → 0). |
| `currentfilter` | What the pager links use to carry the query between pages; `searchstring` also works with `pageidx`. |
| `pageidx` | 1-indexed page (the Previous link on page 1 points at `pageidx=0`). 30 cards per page. |
| `department` | `Engineering`, `Art`, `Design`, `Business`, `Quality Assurance`, `Production`, `IT`, `Audio`, `Human Resources`, `Community`, ... |
| `country` | As listed in the sidebar: `USA`, `Canada`, `UK`, ... `Uruguay`, `Brazil`, `Mexico`. |
| `metro` | Includes `Remote`, plus metro areas (`San Francisco Bay Area`, `London`, ...). |
| `city` | Includes `Remote`, plus cities as `City, Region, Country`. |
| `company` | Company filter (sidebar). Not exposed by the CLI. |

Filters combine (`department=Engineering&metro=Remote&searchstring=unity`). Results are
newest first.

Page structure:

```html
<div class="jobsresultscountrow">
    2513 results
</div>
<div class="jobsindexrow">
  <div class="column jobs">
    <div class="joblisting">
        <a href="/rd/384930" target="_blank">
            Software Engineer - League of Legends
        </a>
        <div>Riot Games - Dublin, Ireland</div>
        <div class="bottomright">
            &lt;1d
        </div>
    </div>
    ...
  </div>
  <div class="filters"> ... sidebar links ... </div>
</div>
<a href="./jobs?currentfilter=unity&amp;pageidx=0" class="btn btn-default disabled">Previous</a>
<a href="./jobs?currentfilter=unity&amp;pageidx=2" class="btn btn-default ">Next</a>
```

- Age: `<1d` or `<N>d` (days since Grackle first saw it).
- `Company - Location` on one line; split on the last ` - `.
- Titles can be double-escaped (`&amp;amp;`) and carry numeric entities (`D&#xE9;veloppeur`).
- A disabled pager link has class `btn btn-default disabled`.

## Job link: `GET https://gracklehq.com/rd/<id>`

302 with `Location:` the employer's posting (Greenhouse, Lever, Workable, studio sites,
LinkedIn). 404 when Grackle has removed the job. The CLI reads the Location header with
`redirect: "manual"` and never requests the target.
