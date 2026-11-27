import { describe, test, expect } from "bun:test"
import { isoDate, formatSalary } from "../src/helpers"
import { normalizePositionId } from "../src/commands/detail"
import { toSearchResult } from "../src/commands/search"
import type { JobDescriptor } from "../src/helpers"

describe("isoDate", () => {
  test("extracts date from full ISO timestamp", () => {
    expect(isoDate("2026-11-01T00:00:00Z")).toBe("2026-11-01")
  })

  test("passes through a bare date string", () => {
    expect(isoDate("2026-11-15")).toBe("2026-11-15")
  })

  test("returns null for null/undefined/empty", () => {
    expect(isoDate(null)).toBeNull()
    expect(isoDate(undefined)).toBeNull()
    expect(isoDate("")).toBeNull()
  })

  test("returns null for unrecognized format", () => {
    expect(isoDate("November 2026")).toBeNull()
  })
})

describe("formatSalary", () => {
  test("formats annual salary range with dollar signs", () => {
    const result = formatSalary([{ MinimumRange: "73301.0", MaximumRange: "95424.0", RateIntervalCode: "PA" }])
    expect(result).toBe("$73,301 – $95,424/yr")
  })

  test("formats hourly rate", () => {
    const result = formatSalary([{ MinimumRange: "25.0", MaximumRange: "35.0", RateIntervalCode: "PH" }])
    expect(result).toBe("$25 – $35/hr")
  })

  test("formats single salary (min == max)", () => {
    const result = formatSalary([{ MinimumRange: "95000.0", MaximumRange: "95000.0", RateIntervalCode: "PA" }])
    expect(result).toBe("$95,000/yr")
  })

  test("returns null for empty array", () => {
    expect(formatSalary([])).toBeNull()
    expect(formatSalary(undefined)).toBeNull()
  })

  test("rounds floating point to integer", () => {
    const result = formatSalary([{ MinimumRange: "73301.49", MaximumRange: "95424.99", RateIntervalCode: "PA" }])
    expect(result).toBe("$73,301 – $95,425/yr")
  })
})

describe("normalizePositionId", () => {
  test("accepts a bare position ID", () => {
    expect(normalizePositionId("USGS-DEF-CA-26-00001")).toBe("USGS-DEF-CA-26-00001")
  })

  test("accepts a numeric MatchedObjectId", () => {
    expect(normalizePositionId("12345678")).toBe("12345678")
  })

  test("extracts numeric ID from usajobs.gov URL", () => {
    expect(normalizePositionId("https://www.usajobs.gov/job/789456123/")).toBe("789456123")
    expect(normalizePositionId("https://www.usajobs.gov/job/789456123")).toBe("789456123")
    expect(normalizePositionId("https://usajobs.gov/job/789456123/")).toBe("789456123")
  })

  test("rejects a URL from any other host", () => {
    expect(normalizePositionId("https://www.example.com/job/789456123/")).toBeNull()
    expect(normalizePositionId("https://usajobs.gov.evil.io/job/123/")).toBeNull()
    expect(normalizePositionId("https://www.usajobs.gov@evil.io/job/123/")).toBeNull()
  })

  test("rejects a usajobs.gov URL without a /job/<id> path", () => {
    expect(normalizePositionId("https://www.usajobs.gov/search/?q=engineer")).toBeNull()
  })

  test("rejects empty and very short strings", () => {
    expect(normalizePositionId("")).toBeNull()
    expect(normalizePositionId("   ")).toBeNull()
    expect(normalizePositionId("ab")).toBeNull()
  })
})

describe("toSearchResult contract fields", () => {
  const descriptor: JobDescriptor = {
    PositionID: "TEST-CA-26-00001",
    PositionTitle: "Test Engineer",
    PositionURI: "https://www.usajobs.gov/job/999/",
    PositionLocationDisplay: "Sacramento, California",
    OrganizationName: "Test Agency",
    PositionSchedule: [{ Name: "Full-Time", Code: "1" }],
    PositionRemuneration: [{ MinimumRange: "60000", MaximumRange: "80000", RateIntervalCode: "PA" }],
    PublicationStartDate: "2026-11-01T00:00:00Z",
    ApplicationCloseDate: "2026-11-30T00:00:00Z",
    UserArea: { Details: { JobSummary: "Job description here.", RemoteIndicator: false } },
  }

  test("maps descriptor to result with all contract fields", () => {
    const result = toSearchResult(descriptor)
    expect(result.id).toBe("TEST-CA-26-00001")
    expect(result.title).toBe("Test Engineer")
    expect(result.company).toBe("Test Agency")
    expect(result.location).toBe("Sacramento, California")
    expect(result.date).toBe("2026-11-01")
    expect(result.deadline).toBe("2026-11-30")
    expect(result.url).toBe("https://www.usajobs.gov/job/999/")
    expect(result.salary).toBe("$60,000 – $80,000/yr")
    expect(result.remote).toBe(false)
    expect(result.schedule).toBe("Full-Time")
  })

  test("remote flag is true when RemoteIndicator is true", () => {
    const result = toSearchResult({
      ...descriptor,
      UserArea: { Details: { RemoteIndicator: true } },
    })
    expect(result.remote).toBe(true)
  })

  test("falls back to DepartmentName when OrganizationName is absent", () => {
    const { OrganizationName: _, ...rest } = descriptor
    const result = toSearchResult({ ...rest, DepartmentName: "Dept of Testing" })
    expect(result.company).toBe("Dept of Testing")
  })
})
