import { describe, expect, test } from "bun:test"
import { daysAgoIso, isCalendarDate, normalizeSearchJob, parseMcpResponse } from "../src/helpers.js"

function toolResult(text: string, isError = false): string {
  return JSON.stringify({ jsonrpc: "2.0", result: { content: [{ type: "text", text }], isError } })
}

describe("MCP response parsing", () => {
  test("reads an SSE text-content JSON result", () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\n  \\"total\\": 1, \\"jobs\\": []\\n}"}]}}\n\n'
    expect(parseMcpResponse(body, "text/event-stream")).toEqual({ total: 1, jobs: [] })
  })

  test("treats an unknown slug as an error, not as a posting", () => {
    // The board answers a missing slug with a *successful* result whose payload
    // is `{ "error": ... }`. Returning that as a job would print "Untitled role"
    // and exit 0, which /scrape reads as a real posting.
    const body = toolResult(JSON.stringify({ error: 'No open posting with slug "nope".' }))
    expect(() => parseMcpResponse(body)).toThrow(/No open posting with slug/)
  })

  test("reports a tool error in the server's own words", () => {
    // isError results carry plain text, so parsing them as JSON would surface a
    // syntax error instead of the server's explanation.
    const body = toolResult("Input validation error: workType: expected one of remote|hybrid|onsite", true)
    expect(() => parseMcpResponse(body)).toThrow(/expected one of remote/)
  })
})

describe("search normalisation", () => {
  test("does not convert unknown work type or AI coverage into a fact", () => {
    const job = normalizeSearchJob({
      slug: "a-role",
      title: "Role",
      company: "Co",
      posted: "2026-09-01",
      detailUrl: "https://example.test/jobs/a-role",
    })
    expect(job).toMatchObject({ id: "a-role", location: null, workType: null, remote: null, aiSkills: null })
  })

  test("keeps a listing the board holds without posting text", () => {
    // These carry no slug, so `detail` cannot read them — but title, company,
    // location, date and apply URL are all present and worth ranking.
    const job = normalizeSearchJob({
      title: "Staff Product Designer, Design Systems",
      company: "Turo",
      city: "San Francisco",
      country: "USA",
      postingTextAvailable: false,
      posted: "2026-07-11",
      applyUrl: "https://example.test/apply/123",
    })
    expect(job).toMatchObject({
      id: null,
      detailUrl: null,
      location: "San Francisco · USA",
      url: "https://example.test/apply/123",
      postingTextAvailable: false,
    })
  })

  test("calculates the posting-age boundary in UTC", () => {
    expect(daysAgoIso(14, new Date("2026-09-01T12:00:00Z"))).toBe("2026-08-18")
  })
})

describe("date guards", () => {
  test("accepts a real calendar day", () => {
    expect(isCalendarDate("2026-08-01")).toBe(true)
    expect(isCalendarDate("2024-02-29")).toBe(true)
  })

  test("rejects dates the board would accept and silently mishandle", () => {
    // The board compares these as strings, so "2026-13-45" sorts above every
    // stored date and a postedBefore filter using it matches the whole board —
    // a filter that looks applied but is not.
    expect(isCalendarDate("2026-13-45")).toBe(false)
    expect(isCalendarDate("2026-02-30")).toBe(false)
    expect(isCalendarDate("2023-02-29")).toBe(false)
    expect(isCalendarDate("08/01/2026")).toBe(false)
    expect(isCalendarDate("2026-08-01T00:00:00Z")).toBe(false)
    expect(isCalendarDate("not-a-date")).toBe(false)
    expect(isCalendarDate("")).toBe(false)
  })
})
