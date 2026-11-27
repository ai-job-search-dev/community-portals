import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { ageInDays, ageToDate, boardQuery, buildUrl, normalizeId, parseJobs, startsAtWord } from "../src/helpers.ts"

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8")
const NOW = new Date("2026-11-17T12:00:00Z")

describe("parseJobs on captured result pages", () => {
  const p1 = parseJobs(fixture("search-unity-p1.html"), NOW)

  test("reads the total and an enabled Next link", () => {
    expect(p1.total).toBe(37)
    expect(p1.hasNext).toBe(true)
    expect(parseJobs(fixture("search-unity-p2.html"), NOW).hasNext).toBe(false)
  })

  test("extracts id, title, company, location, age and URL", () => {
    expect(p1.results).toHaveLength(3)
    expect(p1.results[2]).toEqual({
      id: "384565",
      title: "Engineering Manager (Unity)",
      company: "Scopely",
      location: "Barcelona, Spain",
      date: "2026-11-07",
      dateText: "10d",
      url: "https://gracklehq.com/rd/384565",
    })
    expect(p1.results[0].dateText).toBe("<1d")
    expect(p1.results[0].date).toBe("2026-11-17")
  })

  test("decodes double-escaped titles and accented text", () => {
    const eng = parseJobs(fixture("search-engineering-remote.html"), NOW)
    expect(eng.results[0].title).toBe("Sr. Manager, QA Engineering & Automation")
    expect(eng.results[0].location).toBe("Remote")
    const p2 = parseJobs(fixture("search-unity-p2.html"), NOW)
    expect(p2.results[0].title).toContain("Développeur")
  })

  test("a page with no cards parses to an empty list", () => {
    expect(parseJobs("<html><body>0 results</body></html>").results).toEqual([])
  })
})

describe("query handling", () => {
  test("quotes are dropped before the board sees the text", () => {
    expect(boardQuery('"unity developer"')).toBe("unity developer")
    expect(boardQuery("  ")).toBeUndefined()
  })

  test("substring hits inside a word are dropped (Community for unity)", () => {
    expect(startsAtWord("Director of Community", "unity")).toBe(false)
    expect(startsAtWord("Engineering Manager (Unity)", "unity")).toBe(true)
    expect(startsAtWord("Senior Unity Developer", '"unity developer"')).toBe(true)
    expect(startsAtWord("Anything", undefined)).toBe(true)
  })

  test("buildUrl maps flags to the board's parameters", () => {
    const u = new URL(buildUrl({ query: "unity", location: "Remote", department: "Engineering", page: 2 }))
    expect(u.searchParams.get("searchstring")).toBe("unity")
    expect(u.searchParams.get("metro")).toBe("Remote")
    expect(u.searchParams.get("department")).toBe("Engineering")
    expect(u.searchParams.get("pageidx")).toBe("2")
    expect(new URL(buildUrl({ location: "Uruguay", page: 1 })).searchParams.get("country")).toBe("Uruguay")
    expect(buildUrl({ page: 1 })).toBe("https://gracklehq.com/jobs")
  })
})

describe("ages and ids", () => {
  test("ageToDate understands <1d and Nd only", () => {
    expect(ageToDate("<1d", NOW)).toBe("2026-11-17")
    expect(ageToDate("652d", NOW)).toBe("2025-02-03")
    expect(ageToDate("3 weeks", NOW)).toBeNull()
    expect(ageInDays("2026-11-07", NOW)).toBe(10)
  })

  test("normalizeId accepts an id or a gracklehq.com/rd URL only", () => {
    expect(normalizeId("384925")).toBe("384925")
    expect(normalizeId("https://gracklehq.com/rd/384925")).toBe("384925")
    expect(normalizeId("gracklehq.com/rd/384925/")).toBe("384925")
    expect(normalizeId("https://evil.com/rd/384925")).toBeNull()
    expect(normalizeId("https://gracklehq.com/jobs")).toBeNull()
  })
})
