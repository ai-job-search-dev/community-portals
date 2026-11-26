import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

const BOARD = "acme/wd5/External"

// runCLI preloads tests/no-network.ts, so a validation regression that reaches
// the network fails loudly instead of hitting a live Workday board.
describe("Workday CLI error contract", () => {
  test("search without a board fails with JSON on stderr", async () => {
    const result = await runCLI(["search"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr)).toEqual({
      error:
        "--board is required: Workday has no global index. Pass the employer's careers URL or <tenant>/<instance>/<site>, e.g. --board nvidia/wd5/NVIDIAExternalCareerSite",
      code: "MISSING_REQUIRED",
    })
  })

  test("a board that is not a Workday URL or triple fails before any request", async () => {
    const result = await runCLI(["search", "--board", "nvidia"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_BOARD")
  })

  test("an unknown flag is rejected, never silently dropped", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--location", "Berlin"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("a non-numeric page fails before any request", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--page", "not-a-number"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "BAD_ARG" })
  })

  test("an oversized --jobage is rejected as an argument", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--jobage", "100000000000"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "BAD_ARG" })
  })

  test("a prototype-inherited command name is BAD_CMD, not INTERNAL_ERROR", async () => {
    const result = await runCLI(["constructor"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_CMD")
  })

  test("an unsupported format fails before any request", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--format", "xml"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_ARG")
  })

  test("a repeated single-value option fails instead of silently using the last", async () => {
    const result = await runCLI(["search", "--board", BOARD, "-q", "engineer", "--query", "manager"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "BAD_ARG" })
  })

  test("an empty --query fails instead of silently searching the whole board", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--query", ""])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toEqual({
      error: "--query was given but is empty; omit it to list all postings",
      code: "BAD_ARG",
    })
  })

  test("a page past Workday's 2,000-posting ceiling fails before any request", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--page", "101"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "PAGE_LIMIT" })
  })

  test("detail without an argument fails with JSON on stderr", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toEqual({
      error: "detail requires a <job-url>",
      code: "MISSING_REQUIRED",
    })
  })

  test("detail rejects a non-Workday URL before any request", async () => {
    const result = await runCLI(["detail", "https://evil.example/job/Texas/Engineer_R1"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_ID")
  })

  test("help exits 0", async () => {
    const result = await runCLI(["search", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("USAGE")
    expect(result.stdout).toContain("optional locale may precede /recruiting/")
  })
})
