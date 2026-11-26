import { describe, expect, test } from "bun:test"
import { jobTarget } from "../src/board"
import { parseDetail } from "../src/commands/detail"

const target = jobTarget(
  "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/210675973",
)!

describe("parseDetail", () => {
  test("maps the detail document, joins locations and combines sections", () => {
    const job = parseDetail(
      {
        Title: "Senior Software Engineer",
        PrimaryLocation: "Palo Alto, CA, United States",
        secondaryLocations: [
          { Name: "New York, NY, United States" },
          { Name: "Palo Alto, CA, United States" },
        ],
        WorkplaceTypeCode: "ORA_HYBRID",
        ExternalPostedStartDate: "2026-11-18T10:00:00+00:00",
        ExternalPostedEndDate: "2026-12-31",
        JobSchedule: "Full time",
        LegalEmployer: "Acme Technologies Ltd.",
        ExternalDescriptionStr: "<p>Build <b>fast</b> things.</p>",
        ExternalResponsibilitiesStr: "<ul><li>Ship code</li><li>Review code</li></ul>",
        ExternalQualificationsStr: "<p>Five years with TypeScript.</p>",
      },
      target,
    )

    expect(job).toMatchObject({
      id: target.url,
      title: "Senior Software Engineer",
      company: "Acme Technologies Ltd.",
      location: "Palo Alto, CA, United States · New York, NY, United States · Hybrid",
      date: "2026-11-18",
      deadline: "2026-12-31",
      employmentType: "Full time",
      url: target.url,
    })
    expect(job.description).toBe(
      "Build fast things.\n\nResponsibilities\n- Ship code\n- Review code\n\nQualifications\nFive years with TypeScript.",
    )
  })

  test("falls back to the tenant when no employer name is exposed", () => {
    const job = parseDetail({ Title: "Engineer" }, target)
    expect(job.company).toBe("acme")
    expect(job.location).toBeNull()
    expect(job.date).toBeNull()
    expect(job.deadline).toBeNull()
    expect(job.employmentType).toBeNull()
    expect(job.description).toBeNull()
  })

  test("falls back to the tenant when the employer name is only invisible characters", () => {
    const job = parseDetail(
      { Title: "Engineer", LegalEmployer: "\u200B\u202E", Organization: "  " },
      target,
    )
    expect(job.company).toBe("acme")
  })

  test("falls back to workLocation when PrimaryLocation is missing", () => {
    const job = parseDetail(
      {
        Title: "Engineer",
        PrimaryLocation: null,
        workLocation: [
          { TownOrCity: "Austin", Region: "TX", Country: "United States" },
        ],
        secondaryLocations: [],
      },
      target,
    )
    expect(job.location).toBe("Austin, TX, United States")
  })

  test("falls back to ShortDescriptionStr when the detailed body is empty", () => {
    const job = parseDetail(
      { Title: "Engineer", ShortDescriptionStr: "A short summary &amp; nothing else." },
      target,
    )
    expect(job.description).toBe("A short summary & nothing else.")
  })

  test("unwraps a response wrapped in items[]", () => {
    const job = parseDetail({ items: [{ Title: "Wrapped", JobType: "Contract" }] }, target)
    expect(job.title).toBe("Wrapped")
    expect(job.employmentType).toBe("Contract")
  })

  test("strips tags before decoding entities, so entity-escaped angle brackets survive", () => {
    const job = parseDetail(
      {
        Title: "Engineer",
        ExternalDescriptionStr:
          "<p>Use List&lt;T&gt; and Map&lt;K,V&gt;. Price &mdash; 50&euro; &bull; &copy;</p>",
      },
      target,
    )
    expect(job.description).toBe("Use List<T> and Map<K,V>. Price — 50€ • ©")
  })

  test("drops comments, scripts and hidden text from the description", () => {
    const job = parseDetail(
      {
        Title: "Engineer",
        ExternalDescriptionStr:
          '<p>Visible</p><!-- secret comment --><script>alert("x")</script>' +
          "<noscript>noscript text</noscript>" +
          '<div hidden>hidden text</div><div style="display:none">css hidden</div>' +
          '<div style="display&#58;none">encoded css hidden</div>',
      },
      target,
    )
    expect(job.description).toBe("Visible")
  })

  test("keeps a visible tag whose attribute value contains >", () => {
    const job = parseDetail(
      {
        Title: "Engineer",
        ExternalDescriptionStr: '<p title="a > b">Visible</p>',
      },
      target,
    )
    expect(job.description).toBe("Visible")
  })

  test("does not end a hidden block at a close tag inside a quoted attribute", () => {
    const job = parseDetail(
      {
        Title: "Engineer",
        ExternalDescriptionStr:
          '<div hidden><span title="</div>">Should stay hidden</span>Also hidden</div><p>Visible</p>',
      },
      target,
    )
    expect(job.description).toBe("Visible")
  })

  test("rejects a payload with no title", () => {
    expect(() => parseDetail({ Title: "  " }, target)).toThrow()
    expect(() => parseDetail({}, target)).toThrow()
  })

  test("rejects a title that is only invisible characters", () => {
    expect(() => parseDetail({ Title: "\u200B\u202E" }, target)).toThrow()
  })
})
