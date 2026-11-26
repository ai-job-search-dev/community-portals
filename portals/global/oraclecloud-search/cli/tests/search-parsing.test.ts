import { describe, expect, test } from "bun:test"
import { jobTarget, parseBoard } from "../src/board"
import {
  buildSearchUrl,
  filterByJobage,
  filterByLocation,
  parseSearch,
} from "../src/commands/search"

const board = parseBoard(
  "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs",
)!
const now = new Date("2026-11-25T12:00:00Z")

describe("buildSearchUrl", () => {
  test("sets the finder and top-level paging params, and carries the keyword", () => {
    const url = new URL(buildSearchUrl(board, "software engineer", 20))
    expect(url.origin).toBe("https://acme.fa.us2.oraclecloud.com")
    expect(url.pathname).toBe("/hcmRestApi/resources/latest/recruitingCEJobRequisitions")
    expect(url.searchParams.get("finder")).toContain("findReqs;siteNumber=CX_1")
    expect(url.searchParams.get("finder")).toContain("keyword=software engineer")
    expect(url.searchParams.get("finder")).toContain("offset=20")
    expect(url.searchParams.get("limit")).toBe("20")
    expect(url.searchParams.get("offset")).toBe("20")
    expect(url.searchParams.get("expand")).toContain("secondaryLocations")
  })

  test("omits the keyword when the caller did not give one", () => {
    const url = new URL(buildSearchUrl(board, undefined, 0))
    expect(url.searchParams.get("finder")).not.toContain("keyword=")
  })

  test("carries an optional locationId in the finder", () => {
    const url = new URL(buildSearchUrl(board, "engineer", 0, "300000020694566"))
    expect(url.searchParams.get("finder")).toContain("locationId=300000020694566")
  })

  test("carries an optional postingStartDate in the finder", () => {
    const url = new URL(buildSearchUrl(board, "engineer", 0, undefined, "2026-11-19"))
    expect(url.searchParams.get("finder")).toContain("postingStartDate=2026-11-19")
  })
})

describe("parseSearch", () => {
  test("maps the requisitions payload to the portal result shape", () => {
    const { total, results } = parseSearch(
      {
        items: [
          {
            TotalJobsCount: 120,
            requisitionList: [
              {
                Id: "210675973",
                Title: "Senior Software Engineer",
                PostedDate: "2026-11-22",
                PrimaryLocation: "New York, NY, United States",
                WorkplaceTypeCode: null,
                secondaryLocations: [],
              },
              {
                Id: "210675974",
                Title: "Staff Engineer",
                PostedDate: "2026-11-25",
                PrimaryLocation: "Austin, TX, United States",
                WorkplaceTypeCode: "ORA_REMOTE",
                secondaryLocations: [],
              },
              {
                Id: "210675975",
                Title: "Hybrid Engineer",
                PostedDate: "2026-11-20",
                PrimaryLocation: "Palo Alto, CA, United States",
                WorkplaceTypeCode: "ORA_HYBRID",
                secondaryLocations: [
                  { Name: "New York, NY, United States" },
                  { Name: "Palo Alto, CA, United States" },
                ],
              },
            ],
          },
        ],
      },
      board,
    )

    expect(total).toBe(120)
    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({
      id: "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/210675973",
      title: "Senior Software Engineer",
      company: "acme",
      location: "New York, NY, United States",
      date: "2026-11-22",
      url: "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/210675973",
      description: null,
    })
    expect(results[1].location).toBe("Austin, TX, United States · Remote")
    expect(results[2].location).toBe(
      "Palo Alto, CA, United States · New York, NY, United States · Hybrid",
    )
  })

  test("does not append a workplace hint the location string already says", () => {
    const { results } = parseSearch(
      {
        items: [
          {
            requisitionList: [
              {
                Id: "1",
                Title: "Remote Engineer",
                PrimaryLocation: "Remote, United States",
                WorkplaceTypeCode: "ORA_REMOTE",
              },
            ],
          },
        ],
      },
      board,
    )
    expect(results[0].location).toBe("Remote, United States")
  })

  test("drops a row without Id instead of using RequisitionNumber as the detail key", () => {
    const { results } = parseSearch(
      { items: [{ requisitionList: [{ RequisitionNumber: "R-42", Title: "Engineer" }] }] },
      board,
    )
    expect(results).toEqual([])
  })

  test("drops rows without an id or title instead of inventing a result", () => {
    const { total, results } = parseSearch(
      {
        items: [
          {
            requisitionList: [
              { Id: "1", Title: "" },
              { Id: "", Title: "No id" },
              { Id: "3", Title: "Kept" },
            ],
          },
        ],
      },
      board,
    )
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe("Kept")
    expect(total).toBe(1)
  })

  test("drops an id that is not one URL segment, so every result round-trips", () => {
    const { results } = parseSearch(
      {
        items: [
          {
            requisitionList: [
              { Id: "12/34", Title: "Slash" },
              { Id: "ok-1", Title: "Kept" },
            ],
          },
        ],
      },
      board,
    )
    expect(results.map((result) => result.title)).toEqual(["Kept"])
    expect(jobTarget(results[0].url)).not.toBeNull()
  })

  test("strips invisible characters from third-party text", () => {
    const { results } = parseSearch(
      { items: [{ requisitionList: [{ Id: "1", Title: "Engineer\u200B\u202Eevil" }] }] },
      board,
    )
    expect(results[0].title).toBe("Engineerevil")
  })

  test("drops a title that is only invisible characters", () => {
    const { results } = parseSearch(
      {
        items: [
          {
            requisitionList: [
              { Id: "1", Title: "\u200B\u202E" },
              { Id: "2", Title: "Kept" },
            ],
          },
        ],
      },
      board,
    )
    expect(results.map((result) => result.title)).toEqual(["Kept"])
  })

  test("tolerates a missing items array or requisitionList", () => {
    expect(parseSearch({}, board)).toEqual({ total: 0, results: [] })
    expect(parseSearch({ items: [] }, board)).toEqual({ total: 0, results: [] })
    expect(parseSearch({ items: [{ TotalJobsCount: 0 }] }, board)).toEqual({ total: 0, results: [] })
  })

  test("never reports a total lower than the rows returned", () => {
    const { total } = parseSearch(
      {
        items: [
          {
            TotalJobsCount: 0,
            requisitionList: [
              { Id: "1", Title: "One" },
              { Id: "2", Title: "Two" },
            ],
          },
        ],
      },
      board,
    )
    expect(total).toBe(2)
  })

  test("treats an invalid PostedDate as undated", () => {
    const { results } = parseSearch(
      { items: [{ requisitionList: [{ Id: "1", Title: "Engineer", PostedDate: "not-a-date" }] }] },
      board,
    )
    expect(results[0].date).toBeNull()
  })
})

describe("filters", () => {
  const rows = [
    { title: "A", location: "New York, NY, United States", date: "2026-11-25" },
    { title: "B", location: "Austin, TX, United States · Remote", date: "2026-11-20" },
    { title: "C", location: null, date: null },
  ] as Parameters<typeof filterByLocation>[0]

  test("filterByLocation is a case-insensitive substring match", () => {
    expect(filterByLocation(rows, "new york").map((r) => r.title)).toEqual(["A"])
    expect(filterByLocation(rows, " new york ").map((r) => r.title)).toEqual(["A"])
    expect(filterByLocation(rows, "REMOTE").map((r) => r.title)).toEqual(["B"])
    expect(filterByLocation(rows, "nowhere")).toEqual([])
  })

  test("filterByLocation is a no-op without a location", () => {
    expect(filterByLocation(rows, undefined)).toHaveLength(3)
  })

  test("filterByJobage keeps only postings dated inside the window", () => {
    expect(filterByJobage(rows, 7, now).map((r) => r.date)).toEqual(["2026-11-25", "2026-11-20"])
  })

  test("filterByJobage drops undated postings when a window is requested", () => {
    expect(filterByJobage(rows, 30, now).map((r) => r.title)).toEqual(["A", "B"])
  })

  test("filterByJobage is a no-op without --jobage", () => {
    expect(filterByJobage(rows, undefined, now)).toHaveLength(3)
  })
})
