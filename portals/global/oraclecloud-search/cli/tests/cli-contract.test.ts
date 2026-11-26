import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

const BOARD = "acme.fa.us2.oraclecloud.com/CX_1"

// runCLI preloads tests/no-network.ts, so a validation regression that reaches
// the network fails loudly instead of hitting a live ORC board.
describe("Oracle Recruiting Cloud CLI error contract", () => {
  test("search without a board fails with JSON on stderr", async () => {
    const result = await runCLI(["search"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    const error = JSON.parse(result.stderr)
    expect(error.code).toBe("MISSING_REQUIRED")
    expect(error.error).toContain("--board is required")
  })

  test("a board that is not an ORC careers URL or <host>/<site> fails before any request", async () => {
    const result = await runCLI(["search", "--board", "acme"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_BOARD")
  })

  test("an unknown flag is rejected, never silently dropped", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--remote", "remote"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("--__proto__ is an unknown flag, not dropped", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--__proto__", "x"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("a flag named _ is UNKNOWN_FLAG, not an internal crash", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--_", "x", "y"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("an unsafe --location-id is rejected before any request", async () => {
    for (const value of ["12/34", "abc", ""]) {
      const result = await runCLI(["search", "--board", BOARD, "--location-id", value])
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stderr).code).toBe("BAD_ARG")
    }
  })

  test("a non-numeric page fails before any request", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--page", "not-a-number"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_ARG")
  })

  test("an oversized --jobage is rejected as an argument", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--jobage", "100000000000"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_ARG")
  })

  test("an unsafe numeric literal is rejected before building the request", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--page", "1e308"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_ARG")
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
    expect(JSON.parse(result.stderr).code).toBe("BAD_ARG")
  })

  test("an empty --query or --location fails instead of silently removing the filter", async () => {
    const query = await runCLI(["search", "--board", BOARD, "--query", ""])
    expect(query.exitCode).toBe(1)
    expect(JSON.parse(query.stderr).code).toBe("BAD_ARG")

    const location = await runCLI(["search", "--board", BOARD, "--location", ""])
    expect(location.exitCode).toBe(1)
    expect(JSON.parse(location.stderr).code).toBe("BAD_ARG")
  })

  test("a comma or semicolon in --query fails instead of changing the finder grammar", async () => {
    for (const query of ["software,engineer", "software;engineer"]) {
      const result = await runCLI(["search", "--board", BOARD, "--query", query])
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stderr).code).toBe("BAD_ARG")
    }
  })

  test("a C1 control character in --query is rejected", async () => {
    const result = await runCLI(["search", "--board", BOARD, "--query", "software\u0085engineer"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_ARG")
  })

  test("detail without an argument fails with JSON on stderr", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    const error = JSON.parse(result.stderr)
    expect(error.code).toBe("MISSING_REQUIRED")
    expect(result.stdout).toBe("")
  })

  test("detail rejects a non-ORC URL before any request", async () => {
    const result = await runCLI(["detail", "https://evil.example/job/210675973"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_ID")
  })

  test("detail rejects an ORC careers page that is not a posting", async () => {
    const result = await runCLI([
      "detail",
      "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs",
    ])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_ID")
  })

  test("help exits 0", async () => {
    const result = await runCLI(["search", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("USAGE")
  })
})
