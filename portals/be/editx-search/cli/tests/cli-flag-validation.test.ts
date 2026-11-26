import { describe, expect, test } from "bun:test"
import { runCLI, stderrJSON } from "./helpers"

// Every case here is rejected before any request: the child runs with a
// preload that throws on fetch, so a validation gap would surface as
// INTERNAL_ERROR/SEARCH_FAILED instead of the expected code.

async function expectError(args: string[], code: string) {
  const result = await runCLI(args)
  expect(result.exitCode).toBe(1)
  expect(result.stdout).toBe("")
  const [err] = stderrJSON(result)
  expect(err.code).toBe(code)
  expect(typeof err.error).toBe("string")
}

describe("command and flag validation", () => {
  test("no command prints usage and exits 1", async () => {
    const result = await runCLI([])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("USAGE")
  })

  test("--help with no command exits 0", async () => {
    const result = await runCLI(["--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("USAGE")
  })

  test("--help exits 0", async () => {
    const result = await runCLI(["search", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Personal use only")
  })

  test("unknown command", () => expectError(["find", "-q", "x"], "BAD_CMD"))
  for (const inherited of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    test(`inherited name ${inherited} is not a command`, () => expectError([inherited, "20750"], "BAD_CMD"))
  }
  for (const inherited of ["__proto__", "constructor", "toString"]) {
    for (const form of [[`--${inherited}`, "x"], [`--${inherited}`], [`--${inherited}=x`]]) {
      test(`${form.join(" ")} is rejected as an unknown flag by its own name`, async () => {
        const result = await runCLI(["search", "-q", "python", ...form])
        expect(result.exitCode).toBe(1)
        const [err] = stderrJSON(result)
        expect(err.code).toBe("UNKNOWN_FLAG")
        expect(err.error).toContain(`unknown flag --${inherited} `)
      })
    }
  }
  test("unknown flag is rejected, not ignored", () => expectError(["search", "-q", "python", "--country", "BE"], "UNKNOWN_FLAG"))
  test("flag from the other command is rejected", () => expectError(["detail", "20750", "--page", "2"], "UNKNOWN_FLAG"))
  test("stray positional argument", () => expectError(["search", "-q", "python", "leuven"], "BAD_ARG"))
  test("missing --query", () => expectError(["search", "-l", "Gent"], "BAD_ARG"))
  test("--query without a value", () => expectError(["search", "--query"], "BAD_ARG"))
  test("--query followed by another flag", () => expectError(["search", "--query", "--page", "2"], "BAD_ARG"))
  test("blank --query", () => expectError(["search", "--query", "   "], "BAD_ARG"))
  test("--location without a value", () => expectError(["search", "-q", "python", "-l"], "BAD_ARG"))

  for (const bad of ["0", "-1", "1.5", "3abc", "abc", "", "1e1", "0x2", "+3", " 5", "99999999999999999999"]) {
    test(`--page ${JSON.stringify(bad)} is rejected`, () => expectError(["search", "-q", "python", `--page=${bad}`], "BAD_ARG"))
  }
  test("--limit without a value", () => expectError(["search", "-q", "python", "--limit"], "BAD_ARG"))
  test("--jobage 0.5 is rejected rather than truncated", () => expectError(["search", "-q", "python", "--jobage", "0.5"], "BAD_ARG"))

  test("search --format outside json|table|plain", () => expectError(["search", "-q", "python", "--format", "csv"], "BAD_ARG"))
  test("search --format without a value", () => expectError(["search", "-q", "python", "--format"], "BAD_ARG"))
  test("detail --format table is not offered", () => expectError(["detail", "20750", "--format", "table"], "BAD_ARG"))

  test("detail without an id", () => expectError(["detail"], "NO_ID"))

  test("a repeated flag is rejected, not last-wins", () => expectError(["search", "-q", "python", "-q", "java"], "BAD_ARG"))
  test("an alias and its long form count as the same flag", () => expectError(["search", "-q", "python", "--query", "java"], "BAD_ARG"))

  test("a value that looks like a flag gets a pointer to the = form", async () => {
    const result = await runCLI(["search", "-q", "-net"])
    expect(result.exitCode).toBe(1)
    const [err] = stderrJSON(result)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("--query=-net")
  })
})

describe("detail input is checked before any request", () => {
  for (const bad of [
    "https://evil.example/en/it-jobs/20750",
    "https://editx.eu.evil.example/en/it-jobs/20750",
    "https://editx.eu@evil.example/en/it-jobs/20750",
    "https://user@editx.eu/en/it-jobs/20750",
    "https://api.editx.eu/api/editx/job/20750",
    "https://editx.eu/en/companies/123",
    "ftp://editx.eu/en/it-jobs/20750",
    "20750abc",
    "../20750",
  ]) {
    test(`rejects ${bad}`, () => expectError(["detail", bad], "BAD_ID"))
  }
})
