import { describe, expect, test } from "bun:test"
import { jobTarget, parseBoard, postingTail } from "../src/board"

describe("parseBoard", () => {
  test("parses an ORC careers URL", () => {
    const board = parseBoard(
      "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs",
    )!
    expect(board).toMatchObject({
      host: "jpmc.fa.oraclecloud.com",
      tenant: "jpmc",
      lang: "en",
      site: "CX_1001",
      api: "https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions",
      jobBase: "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001",
    })
  })

  test("accepts a regional host, a locale segment and no /jobs suffix", () => {
    const board = parseBoard(
      "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en-US/sites/CX_1",
    )!
    expect(board.host).toBe("acme.fa.us2.oraclecloud.com")
    expect(board.lang).toBe("en-US")
    expect(board.site).toBe("CX_1")
  })

  test("accepts the ocs and numbered-apex host shapes", () => {
    expect(
      parseBoard("https://acme.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs"),
    ).not.toBeNull()
    expect(
      parseBoard("https://acme.fa.ocs.oraclecloud26.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs"),
    ).not.toBeNull()
  })

  test("parses <host>/<site> with the language defaulted to en", () => {
    const board = parseBoard("jpmc.fa.oraclecloud.com/CX_1001")!
    expect(board.lang).toBe("en")
    expect(board.site).toBe("CX_1001")
  })

  test("parses <host>/<lang>/<site>", () => {
    const board = parseBoard("acme.fa.us2.oraclecloud.com/fr/CX_1")!
    expect(board.lang).toBe("fr")
    expect(board.api).toBe(
      "https://acme.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions",
    )
  })

  test("rejects a bare host: guessing the site would search a site that may not exist", () => {
    expect(parseBoard("jpmc.fa.oraclecloud.com")).toBeNull()
  })

  test("rejects non-ORC and look-alike hosts, including stacked middle labels", () => {
    expect(parseBoard("https://example.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs")).toBeNull()
    expect(
      parseBoard("https://jpmc.fa.oraclecloud.com.evil.example/hcmUI/CandidateExperience/en/sites/CX_1/jobs"),
    ).toBeNull()
    expect(parseBoard("https://jpmc.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs")).toBeNull()
    expect(parseBoard("https://jpmc.fa.oraclecloud0.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs")).toBeNull()
    expect(parseBoard("https://jpmc.fa.oraclecloud100.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs")).toBeNull()
    expect(
      parseBoard("https://acme.fa.ocs.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs"),
    ).toBeNull()
    expect(
      parseBoard("https://acme.fa.us2.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs"),
    ).toBeNull()
  })

  test("rejects a URL without the fixed ORC path positions or with an unsafe segment", () => {
    expect(parseBoard("https://jpmc.fa.oraclecloud.com/careers/CX_1001")).toBeNull()
    expect(parseBoard("https://jpmc.fa.oraclecloud.com/foo/CandidateExperience/en/sites/CX_1/jobs")).toBeNull()
    expect(parseBoard("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/foo/sites/CX_1/jobs")).toBeNull()
    expect(parseBoard("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/../jobs")).toBeNull()
    expect(parseBoard("jpmc.fa.oraclecloud.com/..")).toBeNull()
  })
})

describe("jobTarget", () => {
  const url =
    "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210675973"

  test("rebuilds the canonical posting URL", () => {
    const target = jobTarget(url)!
    expect(target.requisitionId).toBe("210675973")
    expect(target.url).toBe(url)
    expect(target.board.host).toBe("jpmc.fa.oraclecloud.com")
  })

  test("normalizes an http or locale-prefixed URL back to the canonical form", () => {
    expect(
      jobTarget(
        "http://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/fr/sites/CX_1001/job/210675973/",
      )!.url,
    ).toBe(
      "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/fr/sites/CX_1001/job/210675973",
    )
  })

  test("rejects non-posting and non-ORC URLs before any fetch", () => {
    expect(jobTarget("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs")).toBeNull()
    expect(jobTarget("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/")).toBeNull()
    expect(jobTarget("https://evil.example/job/210675973")).toBeNull()
    expect(jobTarget("not a url")).toBeNull()
  })

  test("rejects paths that merely contain the marker segments", () => {
    expect(
      jobTarget("https://jpmc.fa.oraclecloud.com/foo/CandidateExperience/en/sites/CX_1001/job/210675973"),
    ).toBeNull()
    expect(
      jobTarget("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/foo/sites/CX_1001/job/210675973"),
    ).toBeNull()
    expect(
      jobTarget("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/foo/job/210675973"),
    ).toBeNull()
  })
})

describe("postingTail", () => {
  test("returns the requisition id at the end of a posting URL", () => {
    expect(postingTail("https://host/hcmUI/CandidateExperience/en/sites/CX_1/job/210675973")).toBe(
      "210675973",
    )
  })
})
