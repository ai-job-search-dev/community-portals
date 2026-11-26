import { describe, expect, test } from "bun:test"
import { jobTarget } from "../src/board"
import { parseDetail } from "../src/commands/detail"

const target = jobTarget(
  "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506",
)!
const now = new Date("2026-11-25T12:00:00Z")

describe("parseDetail", () => {
  test("maps the detail document and joins multi-location postings", () => {
    const job = parseDetail(
      {
        jobPostingInfo: {
          title: "Senior Software Engineer",
          jobDescription: "<p>Build <b>fast</b> things.</p><ul><li>Write C&#43;&#43;</li><li>Review code</li></ul>",
          location: "Israel, Raanana",
          additionalLocations: ["Israel, Tel Aviv", "Israel, Raanana"],
          startDate: "2026-11-18",
          endDate: "2026-12-31",
          timeType: "Full time",
          canApply: true,
        },
        hiringOrganization: { name: "Acme Technologies Ltd." },
      },
      target,
      now,
    )

    expect(job).toMatchObject({
      id: target.url,
      title: "Senior Software Engineer",
      company: "Acme Technologies Ltd.",
      location: "Israel, Raanana · Israel, Tel Aviv",
      date: "2026-11-18",
      deadline: "2026-12-31",
      employmentType: "Full time",
      canApply: true,
      url: target.url,
    })
    expect(job.description).toBe(
      "Build fast things.\n- Write C++\n- Review code",
    )
  })

  test("falls back to the tenant and the relative posted date", () => {
    const job = parseDetail(
      {
        jobPostingInfo: {
          title: "Engineer",
          jobDescription: "<p>Body</p>",
          postedOn: "Posted 5 Days Ago",
        },
      },
      target,
      now,
    )
    expect(job.company).toBe("nvidia")
    expect(job.location).toBeNull()
    expect(job.date).toBe("2026-11-20")
    expect(job.deadline).toBeNull()
  })

  test("strips tags before decoding entities, so entity-escaped angle brackets survive", () => {
    const job = parseDetail(
      {
        jobPostingInfo: {
          title: "Engineer",
          jobDescription: "<p>Use List&lt;T&gt; and Map&lt;K,V&gt;. Price &mdash; 50&euro; &bull; &copy;</p>",
        },
      },
      target,
      now,
    )
    expect(job.description).toBe("Use List<T> and Map<K,V>. Price — 50€ • ©")
  })

  test("rejects a title that is only invisible characters", () => {
    expect(() =>
      parseDetail({ jobPostingInfo: { title: "\u200B\u202E", jobDescription: "" } }, target, now),
    ).toThrow()
  })

  test("reports whether the board still accepts applications", () => {
    const open = parseDetail(
      { jobPostingInfo: { title: "Open", jobDescription: "", canApply: true } },
      target,
      now,
    )
    const closed = parseDetail(
      { jobPostingInfo: { title: "Closed", jobDescription: "", canApply: false } },
      target,
      now,
    )
    const unstated = parseDetail(
      { jobPostingInfo: { title: "Unstated", jobDescription: "" } },
      target,
      now,
    )
    expect(open.canApply).toBe(true)
    expect(closed.canApply).toBe(false)
    expect(unstated.canApply).toBeNull()
  })

  test("drops comments, scripts and hidden text from the description", () => {
    const job = parseDetail(
      {
        jobPostingInfo: {
          title: "Engineer",
          jobDescription:
            '<p>Visible</p><!-- secret comment --><script>alert("x")</script>' +
            '<noscript>noscript text</noscript>' +
            '<div hidden>hidden text</div><div style="display:none">css hidden</div>' +
            '<div style="display&#58;none">encoded css hidden</div>',
        },
      },
      target,
      now,
    )
    expect(job.description).toBe("Visible")
  })

  test("rejects a payload with no title", () => {
    expect(() => parseDetail({ jobPostingInfo: { title: "  " } }, target, now)).toThrow()
    expect(() => parseDetail({}, target, now)).toThrow()
  })
})
