import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

function errorOutput(stderr: string): { readonly error?: string; readonly code?: string } {
  const parsed: unknown = JSON.parse(stderr)
  if (typeof parsed !== "object" || parsed === null) return {}
  const error = "error" in parsed && typeof parsed.error === "string" ? parsed.error : undefined
  const code = "code" in parsed && typeof parsed.code === "string" ? parsed.code : undefined
  return { ...(error === undefined ? {} : { error }), ...(code === undefined ? {} : { code }) }
}

describe("CLI contract", () => {
  test("search without a query exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search"])
    expect(result.exitCode).toBe(1)
    expect(errorOutput(result.stderr)).toMatchObject({ error: expect.any(String), code: "MISSING_REQUIRED" })
    expect(result.stdout).toBe("")
  })

  test("an unknown flag is rejected, never ignored", async () => {
    const result = await runCLI(["search", "-q", "communicatie", "--radius", "10"])
    expect(result.exitCode).toBe(1)
    expect(errorOutput(result.stderr)).toMatchObject({ error: expect.any(String), code: "UNKNOWN_FLAG" })
  })

  test("an invalid page or job age is a bad argument", async () => {
    for (const args of [["--page", "zero"], ["--jobage", "0"], ["--limit", "1.5"]]) {
      const result = await runCLI(["search", "-q", "communicatie", ...args])
      expect(result.exitCode).toBe(1)
      expect(errorOutput(result.stderr)).toMatchObject({ error: expect.any(String), code: "BAD_ARG" })
    }
  })

  test("an invalid format is a bad argument", async () => {
    const result = await runCLI(["search", "-q", "communicatie", "--format", "xml"])
    expect(result.exitCode).toBe(1)
    expect(errorOutput(result.stderr)).toMatchObject({ error: expect.any(String), code: "BAD_ARG" })
  })

  test("detail without an identifier, or with a foreign URL, exits 1", async () => {
    const missing = await runCLI(["detail"])
    expect(missing.exitCode).toBe(1)
    expect(errorOutput(missing.stderr)).toMatchObject({ error: expect.any(String), code: "NO_ID" })

    const foreign = await runCLI(["detail", "https://example.org/vacatures/x"])
    expect(foreign.exitCode).toBe(1)
    expect(errorOutput(foreign.stderr)).toMatchObject({ error: expect.any(String), code: "BAD_ID" })
  })

  test("--name=value works like --name value", async () => {
    // Blocked network: a valid invocation gets past argument parsing and fails on the fetch.
    const result = await runCLI(["search", "--query=communicatie", "--page=2", "--format=json"])
    expect(errorOutput(result.stderr)).toMatchObject({ error: expect.any(String), code: "SEARCH_FAILED" })
  })

  test("a stray positional argument is rejected", async () => {
    for (const args of [["search", "-q", "communicatie", "extra"], ["detail", "x-1", "extra"]]) {
      const result = await runCLI(args)
      expect(result.exitCode).toBe(1)
      expect(errorOutput(result.stderr)).toMatchObject({ error: expect.any(String), code: "BAD_ARG" })
    }
  })

  test("--location without a value is rejected, not ignored", async () => {
    for (const args of [["-l"], ["--location", ""], ["--location="]]) {
      const result = await runCLI(["search", "-q", "communicatie", ...args])
      expect(result.exitCode).toBe(1)
      expect(errorOutput(result.stderr)).toMatchObject({ error: expect.any(String), code: "BAD_ARG" })
    }
  })
})
