import "./no-network.ts"
import { afterEach, describe, expect, test } from "bun:test"
import {
  decodeHtmlEntities,
  htmlFetch,
  htmlToText,
  matchesLocation,
  matchesWorkplace,
  normalizeWorkplace,
  parseJobPage,
  parsePortal,
  parseSearchPage,
  resolveJobRef,
  searchUrl,
  stripInvisible,
  withinDays,
  type JobCard,
} from "../src/helpers.ts"
import { renderPlain } from "../src/commands/detail.ts"

const ORIGIN = "https://careers-usu.icims.com"

const SEARCH_PAGE = `
<h2 class="iCIMS_SubHeader iCIMS_SubHeader_Jobs"> Search Results
Page 1 of 3 </h2>
<ul class="container-fluid iCIMS_JobsTable">
<li class="iCIMS_JobCardItem">
<div class="col-xs-6 header left"><span class="sr-only field-label">Facility</span><span>Brigham City Campus</span></div>
<div class="col-xs-6 header right">
<span class="sr-only field-label">Posted Date</span>
<span title="11/25/2026 4:02 PM">3 hours ago<span class="sr-only">(11/25/2026 4:02 PM)</span></span>
</div>
<div class="col-xs-12 title">
<a href="https://careers-usu.icims.com/jobs/11021/biology-teaching-assistant/job?in_iframe=1" class="iCIMS_Anchor" title="11021 - Biology Teaching Assistant">
<h3 class="themed">Biology Teaching Assistant &amp; Lab Aide</h3>
</a>
</div>
<dl class="iCIMS_JobHeaderGroup">
<div class="iCIMS_JobHeaderTag"><dt class="iCIMS_JobHeaderField"><span class="glyphicons"></span><span class="sr-only field-label">Job Locations</span></dt><dd class="iCIMS_JobHeaderData"><span>US-UT-Brigham City</span></dd></div>
</dl>
</li>
</ul>`

describe("parsePortal", () => {
  test("host label", () => {
    expect(parsePortal("careers-usu")).toEqual({
      origin: "https://careers-usu.icims.com",
      host: "careers-usu.icims.com",
      label: "careers-usu",
    })
  })
  test("portal URL, with or without a scheme", () => {
    expect(parsePortal("https://careers-usu.icims.com/jobs/search?ss=1")?.label).toBe("careers-usu")
    expect(parsePortal("careers-usu.icims.com/jobs")?.host).toBe("careers-usu.icims.com")
  })
  test("the portal homepage is enough: the host names the portal", () => {
    expect(parsePortal("https://careers-usu.icims.com/")).toEqual({
      origin: "https://careers-usu.icims.com",
      host: "careers-usu.icims.com",
      label: "careers-usu",
    })
    expect(parsePortal("https://careers-usu.icims.com/careers/apply")?.label).toBe("careers-usu")
  })
  test("only icims.com hosts are accepted", () => {
    expect(parsePortal("https://icims.com.evil.io/jobs/search")).toBeNull()
    expect(parsePortal("https://careers-usu.icims.com@evil.io/jobs/search")).toBeNull()
    expect(parsePortal("https://example.com/jobs/search")).toBeNull()
    expect(parsePortal("")).toBeNull()
  })
})

describe("searchUrl", () => {
  test("maps --page to iCIMS's 0-based pr and sends the keyword to iCIMS", () => {
    const url = new URL(searchUrl(ORIGIN, 2, "registered nurse"))
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/jobs/search`)
    expect(url.searchParams.get("pr")).toBe("1")
    expect(url.searchParams.get("ss")).toBe("1")
    expect(url.searchParams.get("in_iframe")).toBe("1")
    expect(url.searchParams.get("searchKeyword")).toBe("registered nurse")
    expect(url.searchParams.get("searchRelation")).toBe("keyword_all")
  })
  test("no keyword, no search params", () => {
    const url = new URL(searchUrl(ORIGIN, 1))
    expect(url.searchParams.get("searchKeyword")).toBeNull()
    expect(url.searchParams.get("searchRelation")).toBeNull()
  })
})

describe("parseSearchPage", () => {
  const page = parseSearchPage(SEARCH_PAGE, ORIGIN, "careers-usu")

  test("reads the printed page count", () => {
    expect(page.totalPages).toBe(3)
  })
  test("card fields, with entities decoded and the query stripped from the URL", () => {
    expect(page.jobs).toHaveLength(1)
    expect(page.jobs[0]).toEqual({
      id: "11021",
      title: "Biology Teaching Assistant & Lab Aide",
      company: "careers-usu",
      location: "US-UT-Brigham City",
      date: "2026-11-25",
      url: `${ORIGIN}/jobs/11021/biology-teaching-assistant/job`,
      workplace: null,
    })
  })
  test("reads the portal's telework field, a Remote location, and its absence", () => {
    const card = (fields: string, location = "US-UT-Logan") => `<li class="iCIMS_JobCardItem">
      <a href="/jobs/1/x/job"><h3>T</h3></a>
      <dl><div><dt>Job Locations</dt><dd>${location}</dd></div>${fields}</dl>
    </li>`
    const workplace = (html: string) => parseSearchPage(html, ORIGIN, "careers-usu").jobs[0].workplace
    expect(workplace(card("<div><dt>Telework Eligible</dt><dd>Hybrid</dd></div>"))).toBe("hybrid")
    expect(workplace(card("<div><dt>Telework Eligible</dt><dd>No</dd></div>"))).toBe("onsite")
    expect(workplace(card("<div><dt>Remote</dt><dd>Yes</dd></div>"))).toBe("remote")
    expect(workplace(card("", "US-Remote"))).toBe("remote")
    // Invisible characters must not hide a declared mode from the filter.
    expect(workplace(card("<div><dt>Tele\u200Bwork Eligible</dt><dd>Hyb\u200Brid</dd></div>"))).toBe("hybrid")
    expect(workplace(card("", "US-Re\u200Bmote"))).toBe("remote")
    expect(workplace(card(""))).toBeNull()
  })
  test("keeps a relative posting link and falls back to the header City", () => {
    const html = `<li class="iCIMS_JobCardItem">
      <span class="sr-only field-label">City</span><span>Logan Campus</span>
      <a href="/jobs/11022/part-time-tutor/job?in_iframe=1" class="iCIMS_Anchor"><h3>Part-Time Tutor</h3></a>
    </li>`
    const [card] = parseSearchPage(html, ORIGIN, "careers-usu").jobs
    expect(card).toMatchObject({
      id: "11022",
      title: "Part-Time Tutor",
      location: "Logan Campus",
      date: null,
      url: `${ORIGIN}/jobs/11022/part-time-tutor/job`,
    })
  })
  test("decodes the anchor title when a card has no h3", () => {
    const html = `<li class="iCIMS_JobCardItem"><a href="/jobs/11023/rd/job" title="11023 - R&amp;D Engineer"></a></li>`
    const [card] = parseSearchPage(html, ORIGIN, "careers-usu").jobs
    expect(card).toMatchObject({ id: "11023", title: "R&D Engineer" })
  })
  test("a sibling iCIMS host is kept, an off-icims host is dropped", () => {
    const html = `<li class="iCIMS_JobCardItem"><a href="https://externalcareers-ohsu.icims.com/jobs/44360/rn/job?hub=6"><h3>RN</h3></a></li>
      <li class="iCIMS_JobCardItem"><a href="https://jobs.icims.com.evil.io/jobs/9/phish/job"><h3>Phish</h3></a></li>`
    const jobs = parseSearchPage(html, ORIGIN, "careersat-ohsu").jobs
    expect(jobs.map((j) => j.url)).toEqual(["https://externalcareers-ohsu.icims.com/jobs/44360/rn/job"])
  })
  test("an empty results page has no cards and no printed page count", () => {
    expect(parseSearchPage("<html><body>No results</body></html>", ORIGIN, "careers-usu")).toEqual({
      jobs: [],
      totalPages: null,
    })
  })
})

describe("resolveJobRef", () => {
  test("a posting URL keeps its own host and drops the query", () => {
    expect(resolveJobRef("https://careers-usu.icims.com/jobs/11021/biology-teaching-assistant/job?in_iframe=1")).toEqual({
      id: "11021",
      url: "https://careers-usu.icims.com/jobs/11021/biology-teaching-assistant/job?in_iframe=1",
      company: "careers-usu",
    })
  })
  test("the slug is optional", () => {
    expect(resolveJobRef("https://careers-usu.icims.com/jobs/11021/job")?.id).toBe("11021")
  })
  test("a bare ID needs --portal", () => {
    expect(resolveJobRef("11021")).toBeNull()
    expect(resolveJobRef("11021", parsePortal("careers-usu")!)).toEqual({
      id: "11021",
      url: `${ORIGIN}/jobs/11021/job?in_iframe=1`,
      company: "careers-usu",
    })
  })
  test("look-alike, foreign and non-posting URLs are rejected", () => {
    expect(resolveJobRef("https://careers-usu.icims.com.evil.io/jobs/1/x/job")).toBeNull()
    expect(resolveJobRef("https://careers-usu.icims.com@evil.io/jobs/1/x/job")).toBeNull()
    expect(resolveJobRef("https://example.com/jobs/1/x/job")).toBeNull()
    expect(resolveJobRef("https://careers-usu.icims.com/jobs/search?ss=1")).toBeNull()
    expect(resolveJobRef("https://careers-usu.icims.com/jobs/abc/x/job")).toBeNull()
  })
})

describe("parseJobPage", () => {
  const URL_11021 = `${ORIGIN}/jobs/11021/biology-teaching-assistant/job?in_iframe=1`
  const jsonLd = (node: object) =>
    // JSON escaping keeps a `</script>` inside the payload from ending the tag early.
    `<script type="application/ld+json">${JSON.stringify(node).replace(/<\//g, "<\\/")}</script>`

  test("JSON-LD fields, skipping UNAVAILABLE parts and the UNAVAILABLE place", () => {
    const job = parseJobPage(
      `${jsonLd({
        "@type": "JobPosting",
        title: "Biology Teaching Assistant",
        datePosted: "2026-11-25T05:00:00.000Z",
        employmentType: "FULL_TIME",
        jobLocation: [
          { address: { addressLocality: "UNAVAILABLE", addressCountry: "UNAVAILABLE" } },
          { address: { addressLocality: "Brigham City", addressRegion: "UT", addressCountry: "US" } },
        ],
        description: "<p>Body</p>",
      })}<h1 class="iCIMS_Header">Fallback title</h1>
      <dl><dt class="iCIMS_JobHeaderField">Requisition ID</dt><dd class="iCIMS_JobHeaderData"><span>2026-11021</span></dd></dl>`,
      URL_11021,
      "careers-usu",
    )
    expect(job).toMatchObject({
      id: "11021",
      title: "Biology Teaching Assistant",
      location: "Brigham City, UT, US",
      date: "2026-11-25",
      employmentType: "FULL_TIME",
      requisitionId: "2026-11021",
      description: "Body",
      url: `${ORIGIN}/jobs/11021/biology-teaching-assistant/job`,
    })
  })
  test("workplace from JSON-LD, the telework field, or a Remote location", () => {
    const remote = parseJobPage(
      jsonLd({ "@type": "JobPosting", title: "T", jobLocationType: "TELECOMMUTE" }),
      URL_11021,
      "careers-usu",
    )
    expect(remote?.workplace).toBe("remote")
    const hybrid = parseJobPage(
      `<h1 class="iCIMS_Header">T</h1><dl><dt>Telework Eligible</dt><dd>Hybrid</dd></dl>`,
      URL_11021,
      "careers-usu",
    )
    expect(hybrid?.workplace).toBe("hybrid")
    const location = parseJobPage(
      `<h1 class="iCIMS_Header">T</h1><dl><dt>Location</dt><dd>US-Remote</dd></dl>`,
      URL_11021,
      "careers-usu",
    )
    expect(location?.workplace).toBe("remote")
    const invisible = parseJobPage(
      jsonLd({ "@type": "JobPosting", title: "T", jobLocationType: "TELECOM\u200BMUTE" }),
      URL_11021,
      "careers-usu",
    )
    expect(invisible?.workplace).toBe("remote")
  })
  test("page markup fallback when the portal emits no JSON-LD", () => {
    const job = parseJobPage(
      `<h1 class="iCIMS_Header">Nurse</h1>
       <span class="sr-only field-label">Posted Date</span><span title="11/20/2026 8:00 AM">6 days ago</span>
       <dl>
         <dt class="iCIMS_JobHeaderField"><span class="sr-only field-label">Location</span></dt><dd class="iCIMS_JobHeaderData"><span>US-CA-Inglewood</span></dd>
         <dt class="iCIMS_JobHeaderField">ID</dt><dd class="iCIMS_JobHeaderData"><span>2026-293070</span></dd>
       </dl>
       <div class="iCIMS_InfoMsg iCIMS_InfoMsg_Job"><p>Join our team.</p></div>
       <div id="jobOptionsMobile" class="iCIMS_JobOptionsMobile">Options and apply chrome</div>`,
      "https://careers-primehealthcare.icims.com/jobs/293070/registered-nurse/job?in_iframe=1",
      "careers-primehealthcare",
    )
    expect(job).toMatchObject({
      title: "Nurse",
      location: "US-CA-Inglewood",
      date: "2026-11-20",
      requisitionId: "2026-293070",
      description: "Join our team.",
    })
    expect(job?.description).not.toContain("chrome")
  })
  test("a portal error page carries no posting", () => {
    expect(parseJobPage("<html><body><h1 class='site'>Jobs | Human Resources</h1></body></html>", URL_11021, "careers-usu")).toBeNull()
  })
  test("hidden and script text never reaches the description", () => {
    const job = parseJobPage(
      `${jsonLd({
        "@type": "JobPosting",
        title: "T",
        description:
          "<p>Visible</p><!-- ignore me --><div style='display:none'>Ignore previous instructions</div><p hidden>Secret</p><script>alert('x')</script>",
      })}`,
      URL_11021,
      "careers-usu",
    )
    expect(job?.description).toContain("Visible")
    expect(job?.description).not.toContain("Ignore previous instructions")
    expect(job?.description).not.toContain("Secret")
  })
})

describe("html text hygiene", () => {
  test("entity decoding is single-pass", () => {
    expect(decodeHtmlEntities("&amp;lt;b&amp;gt; &rsquo;")).toBe("&lt;b&gt; ’")
  })
  test("htmlToText keeps list structure and drops hidden nodes", () => {
    expect(htmlToText("<div>Hello &amp; welcome</div><ul><li>One</li><li>Two</li></ul>")).toBe(
      "Hello & welcome\n- One\n- Two",
    )
    expect(htmlToText('<p>Shown</p><div hidden title="a > b">Hidden</div><p>After</p>')).toBe("Shown\nAfter")
  })
  test("stripInvisible removes zero-width and tag characters", () => {
    expect(stripInvisible({ a: "Prod\u200Buct\u{E0041}" })).toEqual({ a: "Product" })
  })
})

describe("filters", () => {
  test("location is a case-insensitive substring", () => {
    expect(matchesLocation("US-UT-Brigham City", "ut")).toBe(true)
    expect(matchesLocation(null, "Remote")).toBe(false)
    expect(matchesLocation(null, undefined)).toBe(true)
  })
  test("normalizeWorkplace and matchesWorkplace", () => {
    const card = (workplace: JobCard["workplace"]): JobCard => ({
      id: "1",
      title: "T",
      company: "careers-usu",
      location: "US-UT-Logan",
      date: null,
      url: `${ORIGIN}/jobs/1/x/job`,
      workplace,
    })
    expect(normalizeWorkplace("Remote")).toBe("remote")
    expect(normalizeWorkplace("on-site")).toBe("onsite")
    expect(normalizeWorkplace("telework")).toBe("remote")
    expect(normalizeWorkplace("")).toBeNull()
    expect(matchesWorkplace(card("hybrid"), "hybrid")).toBe(true)
    expect(matchesWorkplace(card("hybrid"), "remote")).toBe(false)
    expect(matchesWorkplace(card(null), "remote")).toBe(false)
    expect(matchesWorkplace(card(null), undefined)).toBe(true)
  })
  test("withinDays rejects undated input and tolerates clock skew", () => {
    const now = Date.parse("2026-11-06T12:00:00Z")
    expect(withinDays("2026-11-01", 7, now)).toBe(true)
    expect(withinDays("2026-10-01", 7, now)).toBe(false)
    expect(withinDays(null, 7, now)).toBe(false)
    expect(withinDays("2026-12-01", 7, now)).toBe(false)
    expect(withinDays("2026-11-06", 7, now)).toBe(true)
    expect(withinDays(null, undefined, now)).toBe(true)
  })
  test("a date-only value allows a day of skew: a portal's date can be ahead of UTC", () => {
    // The card says "2026-11-25" (= midnight UTC); the reader's clock is still
    // on the evening of the 24th in UTC.
    expect(withinDays("2026-11-25", 7, Date.parse("2026-11-24T22:30:00Z"))).toBe(true)
    // A full timestamp keeps the tight one-hour allowance.
    expect(withinDays("2026-11-25T05:00:00Z", 7, Date.parse("2026-11-24T22:30:00Z"))).toBe(false)
  })
})

describe("htmlFetch backoff", () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })
  test("retries a 429, honoring Retry-After, then returns the body", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return calls === 1
        ? new Response("", { status: 429, headers: { "retry-after": "1" } })
        : new Response("<p>ok</p>", { status: 200 })
    }) as unknown as typeof fetch
    expect(await htmlFetch(SEARCH_PAGE_URL(), { maxRetries: 2, baseDelayMs: 1 })).toBe("<p>ok</p>")
    expect(calls).toBe(2)
  })
  test("a Retry-After past the retry budget fails at once", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response("", { status: 429, headers: { "retry-after": "5" } })
    }) as unknown as typeof fetch
    await expect(
      htmlFetch(SEARCH_PAGE_URL(), { maxRetries: 3, baseDelayMs: 1, budgetMs: 1000 }),
    ).rejects.toThrow("retry budget")
    expect(calls).toBe(1)
  })
  test("follows only redirects that stay on iCIMS and a /jobs path", async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: unknown) => {
      calls.push(String(input))
      return calls.length === 1
        ? new Response("", { status: 302, headers: { location: "https://externalcareers-ohsu.icims.com/jobs/1/rn/job" } })
        : new Response("<p>ok</p>", { status: 200 })
    }) as unknown as typeof fetch
    expect(await htmlFetch(SEARCH_PAGE_URL())).toBe("<p>ok</p>")
    expect(calls).toEqual([
      SEARCH_PAGE_URL(),
      "https://externalcareers-ohsu.icims.com/jobs/1/rn/job",
    ])
  })
  test("a redirect does not reset the retry budget", async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input)
      calls.push(url)
      if (url === SEARCH_PAGE_URL()) {
        return calls.length === 1
          ? new Response("", { status: 429, headers: { "retry-after": "0.1" } })
          : new Response("", { status: 302, headers: { location: "https://externalcareers-ohsu.icims.com/jobs/1/rn/job" } })
      }
      // The target answers 200 on a second try; with a reset budget the hop
      // would be allowed to spend it and resolve instead of failing here.
      return calls.length === 3
        ? new Response("", { status: 429, headers: { "retry-after": "0.1" } })
        : new Response("<p>ok</p>", { status: 200 })
    }) as unknown as typeof fetch
    await expect(
      htmlFetch(SEARCH_PAGE_URL(), { maxRetries: 3, baseDelayMs: 1, budgetMs: 150 }),
    ).rejects.toThrow("retry budget")
    expect(calls).toHaveLength(3)
  })
  test("refuses a redirect off the iCIMS hosts, without fetching it", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response("", { status: 302, headers: { location: "https://evil.example/jobs/1/rn/job" } })
    }) as unknown as typeof fetch
    await expect(htmlFetch(SEARCH_PAGE_URL())).rejects.toThrow("off the iCIMS portal")
    expect(calls).toBe(1)
  })
  test("refuses a redirect to a non-/jobs path on iCIMS", async () => {
    globalThis.fetch = (async () =>
      new Response("", { status: 302, headers: { location: "https://careers-usu.icims.com/connect/resume" } })) as unknown as typeof fetch
    await expect(htmlFetch(SEARCH_PAGE_URL())).rejects.toThrow("off the iCIMS portal")
  })
  test("a redirect loop stops", async () => {
    globalThis.fetch = (async (input: unknown) =>
      new Response("", { status: 302, headers: { location: String(input) } })) as unknown as typeof fetch
    await expect(htmlFetch(SEARCH_PAGE_URL())).rejects.toThrow("too many redirects")
  })
  test("404 and 410 return null; repeated 5xx throws", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch
    expect(await htmlFetch(SEARCH_PAGE_URL())).toBeNull()
    globalThis.fetch = (async () => new Response("", { status: 410 })) as unknown as typeof fetch
    expect(await htmlFetch(SEARCH_PAGE_URL())).toBeNull()
    globalThis.fetch = (async () => new Response("", { status: 503, statusText: "Service Unavailable" })) as unknown as typeof fetch
    await expect(htmlFetch(SEARCH_PAGE_URL(), { maxRetries: 1, baseDelayMs: 1 })).rejects.toThrow("503")
  })
})

function SEARCH_PAGE_URL(): string {
  return `${ORIGIN}/jobs/search?ss=1`
}

describe("renderPlain", () => {
  test("renders the header, present fields and body", () => {
    const out = renderPlain({
      id: "11021",
      title: "TA",
      company: "careers-usu",
      location: "Brigham City, UT, US",
      date: "2026-11-25",
      url: `${ORIGIN}/jobs/11021/x/job`,
      workplace: "remote",
      description: "Body.",
      employmentType: null,
      requisitionId: "2026-11021",
    })
    expect(out).toContain("careers-usu · Brigham City, UT, US")
    expect(out).toContain("Posted: 2026-11-25")
    expect(out).toContain("Workplace: remote")
    expect(out).toContain("Requisition ID: 2026-11021")
    expect(out).not.toContain("Employment:")
    expect(out).toContain("Body.")
  })
})
