import { describe, expect, test } from "bun:test"
import { parseBoard } from "../src/board"
import { filterByJobage, parseSearch } from "../src/commands/search"
import { parsePostedOn } from "../src/helpers"

const board = parseBoard("https://acme.wd5.myworkdayjobs.com/External")!
const now = new Date("2026-11-25T12:00:00Z")

describe("parseSearch", () => {
  test("maps the CXS list payload to the portal result shape", () => {
    const { total, results } = parseSearch(
      {
        total: 120,
        jobPostings: [
          {
            title: "Senior Software Engineer",
            externalPath: "/job/Texas-Austin/Senior-Software-Engineer_R123",
            locationsText: "Texas, Austin",
            postedOn: "Posted 3 Days Ago",
          },
          {
            title: "Staff Engineer",
            externalPath: "/job/Remote/Staff-Engineer_R456",
            locationsText: "2 Locations",
            postedOn: "Posted Today",
            remoteType: "Fully Remote",
          },
          {
            title: "Old Engineer",
            externalPath: "/job/Ohio/Old-Engineer_R789",
            locationsText: "",
            postedOn: "Posted 30+ Days Ago",
          },
        ],
      },
      board,
      now,
    )

    expect(total).toBe(120)
    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({
      id: "https://acme.wd5.myworkdayjobs.com/External/job/Texas-Austin/Senior-Software-Engineer_R123",
      title: "Senior Software Engineer",
      company: "acme",
      location: "Texas, Austin",
      date: "2026-11-22",
      url: "https://acme.wd5.myworkdayjobs.com/External/job/Texas-Austin/Senior-Software-Engineer_R123",
      description: null,
    })
    expect(results[1].location).toBe("2 Locations · Remote")
    expect(results[2].location).toBe("Ohio")
    // "30+ Days Ago" is unbounded, so it has no usable date.
    expect(results[2].date).toBeNull()
  })

  test("drops rows without a title or a /job/ path instead of inventing a result", () => {
    const { total, results } = parseSearch(
      {
        jobPostings: [
          { title: "", externalPath: "/job/Texas/Engineer_R1" },
          { title: "Engineer", externalPath: "/about" },
          { title: "Kept", externalPath: "/job/Texas/Kept_R2" },
        ],
      },
      board,
      now,
    )
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe("Kept")
    expect(total).toBe(1)
  })

  test("strips invisible characters from third-party text", () => {
    const { results } = parseSearch(
      {
        jobPostings: [
          { title: "Engineer\u200B\u202Eevil", externalPath: "/job/Texas/Engineer_R1" },
        ],
      },
      board,
      now,
    )
    expect(results[0].title).toBe("Engineerevil")
  })

  test("tolerates a missing jobPostings array", () => {
    expect(parseSearch({ total: 0 }, board, now)).toEqual({ total: 0, results: [] })
  })

  test("drops a title that is only invisible characters", () => {
    const { results } = parseSearch(
      {
        jobPostings: [
          { title: "\u200B\u202E", externalPath: "/job/Texas/Blank_R1" },
          { title: "Kept", externalPath: "/job/Texas/Kept_R2" },
        ],
      },
      board,
      now,
    )
    expect(results.map((result) => result.title)).toEqual(["Kept"])
  })

  test("never reports a total lower than the rows returned", () => {
    const { total, results } = parseSearch(
      {
        total: 0,
        jobPostings: [{ title: "Engineer", externalPath: "/job/Texas/Engineer_R1" }],
      },
      board,
      now,
    )
    expect(results).toHaveLength(1)
    expect(total).toBe(1)
  })

  test("raises a positive total that is lower than the rows returned", () => {
    const { total, results } = parseSearch(
      {
        total: 1,
        jobPostings: [
          { title: "One", externalPath: "/job/Texas/One_R1" },
          { title: "Two", externalPath: "/job/Texas/Two_R2" },
        ],
      },
      board,
      now,
    )
    expect(results).toHaveLength(2)
    expect(total).toBe(2)
  })

  test("treats an out-of-range relative day count as undated", () => {
    expect(parsePostedOn("Posted 999999999999999999999 Days Ago", now)).toBeNull()
  })
})

describe("filterByJobage", () => {
  const rows = [
    { date: "2026-11-25" },
    { date: "2026-11-20" },
    { date: null },
  ] as Parameters<typeof filterByJobage>[0]

  test("keeps only postings dated inside the window", () => {
    expect(filterByJobage(rows, 7, now).map((r) => r.date)).toEqual(["2026-11-25", "2026-11-20"])
  })

  test("drops undated postings when a window is requested", () => {
    expect(filterByJobage(rows, 30, now).map((r) => r.date)).toEqual(["2026-11-25", "2026-11-20"])
  })

  test("is a no-op without --jobage", () => {
    expect(filterByJobage(rows, undefined, now)).toHaveLength(3)
  })
})
