import { describe, expect, test } from "bun:test"
import { jobTarget, parseBoard, postingTail } from "../src/board"

describe("parseBoard", () => {
  test("parses a myworkdayjobs careers URL", () => {
    const board = parseBoard("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite")!
    expect(board).toMatchObject({
      tenant: "nvidia",
      site: "NVIDIAExternalCareerSite",
      api: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs",
      cxsBase: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite",
      jobBase: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
    })
  })

  test("skips a locale segment in the careers URL", () => {
    const board = parseBoard("https://acme.wd3.myworkdayjobs.com/en-US/External/job/Texas/Engineer_R1")!
    expect(board.site).toBe("External")
    expect(board.api).toBe("https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs")
  })

  test("parses a myworkdaysite recruiting URL", () => {
    const board = parseBoard("https://wd1.myworkdaysite.com/recruiting/acme/AcmeCareers")!
    expect(board).toMatchObject({
      tenant: "acme",
      site: "AcmeCareers",
      api: "https://wd1.myworkdaysite.com/wday/cxs/acme/AcmeCareers/jobs",
      jobBase: "https://wd1.myworkdaysite.com/recruiting/acme/AcmeCareers",
    })
  })

  test("skips a locale before /recruiting/ on a myworkdaysite URL", () => {
    const board = parseBoard("https://wd3.myworkdaysite.com/en-US/recruiting/mdlz/External")!
    expect(board.tenant).toBe("mdlz")
    expect(board.site).toBe("External")
    expect(board.api).toBe("https://wd3.myworkdaysite.com/wday/cxs/mdlz/External/jobs")
  })

  test("parses the tenant/instance/site triple", () => {
    const board = parseBoard("Acme/WD5/External")!
    expect(board.tenant).toBe("acme")
    expect(board.api).toBe("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs")
    expect(board.site).toBe("External")
  })

  test("honors a CXS endpoint URL instead of reading `wday` as the site", () => {
    const board = parseBoard(
      "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs",
    )!
    expect(board.site).toBe("External")
    expect(parseBoard("https://acme.wd3.myworkdayjobs.com/wday/cxs/other/External/jobs")).toBeNull()
  })

  test("rejects a bare tenant: guessing the instance would search a board that may not exist", () => {
    expect(parseBoard("nvidia")).toBeNull()
  })

  test("rejects non-Workday and look-alike hosts", () => {
    expect(parseBoard("https://example.com/careers")).toBeNull()
    expect(parseBoard("https://nvidia.wd5.myworkdayjobs.com.evil.example/NVIDIAExternalCareerSite")).toBeNull()
    expect(parseBoard("https://nvidia.wdX.myworkdayjobs.com/Site")).toBeNull()
  })

  test("rejects a triple with an invalid instance", () => {
    expect(parseBoard("acme/prod/site")).toBeNull()
    expect(parseBoard("acme/wd5")).toBeNull()
  })

  test("rejects a triple tenant with a hostname-unsafe underscore", () => {
    expect(parseBoard("acme_inc/wd5/External")).toBeNull()
  })

  test("rejects dot-segment site names that URL normalization would drop", () => {
    expect(parseBoard("acme/wd5/.")).toBeNull()
    expect(parseBoard("acme/wd5/..")).toBeNull()
  })
})

describe("jobTarget", () => {
  const url =
    "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506"

  test("rebuilds the detail endpoint and the canonical posting URL", () => {
    const target = jobTarget(url)!
    expect(target.externalPath).toBe("/job/Israel-Raanana/Senior-Software-Engineer_JR2016506")
    expect(target.board.cxsBase + target.externalPath).toBe(
      "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR2016506",
    )
    expect(target.url).toBe(url)
  })

  test("normalizes a locale-prefixed URL back to the canonical form", () => {
    const target = jobTarget(
      "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Texas/Engineer_R1",
    )!
    expect(target.url).toBe(
      "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Texas/Engineer_R1",
    )
  })

  test("parses a myworkdaysite posting URL", () => {
    const target = jobTarget(
      "https://wd1.myworkdaysite.com/recruiting/acme/AcmeCareers/job/Berlin/Engineer_R42",
    )!
    expect(target.board.cxsBase).toBe("https://wd1.myworkdaysite.com/wday/cxs/acme/AcmeCareers")
    expect(target.url).toBe(
      "https://wd1.myworkdaysite.com/recruiting/acme/AcmeCareers/job/Berlin/Engineer_R42",
    )
  })

  test("parses a locale-prefixed myworkdaysite posting URL", () => {
    const target = jobTarget(
      "https://wd3.myworkdaysite.com/en-US/recruiting/mdlz/External/job/Berlin/Engineer_R42",
    )!
    expect(target.board.cxsBase).toBe("https://wd3.myworkdaysite.com/wday/cxs/mdlz/External")
    expect(target.externalPath).toBe("/job/Berlin/Engineer_R42")
  })

  test("rejects non-posting and non-Workday URLs before any fetch", () => {
    expect(jobTarget("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite")).toBeNull()
    expect(jobTarget("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/foo/bar")).toBeNull()
    expect(jobTarget("https://evil.example/job/Texas/Engineer_R1")).toBeNull()
    expect(jobTarget("not a url")).toBeNull()
  })

  test("rejects a /job/ path with no posting segments", () => {
    expect(jobTarget("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/")).toBeNull()
    expect(jobTarget("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Texas")).toBeNull()
    expect(
      jobTarget("https://wd1.myworkdaysite.com/recruiting/acme/AcmeCareers/job/Berlin"),
    ).toBeNull()
  })
})

describe("postingTail", () => {
  test("returns the requisition after the first underscore", () => {
    expect(postingTail("/job/Texas/Staff-Software-Engineer_JR_2024_001")).toBe("JR_2024_001")
    expect(postingTail("/job/Texas/Staff-Software-Engineer_R167982-1")).toBe("R167982-1")
  })

  test("falls back to the last segment when there is no underscore", () => {
    expect(postingTail("/job/Texas/Engineer")).toBe("Engineer")
  })
})
