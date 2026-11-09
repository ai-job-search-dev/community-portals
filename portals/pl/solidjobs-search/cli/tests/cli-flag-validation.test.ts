import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.ts"

// Every case here must fail during argument validation, before any request.

function stderrJSON(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr) as { error: string; code: string }
}

async function expectRejected(args: string[], code: string) {
  const r = await runCLI(args)
  expect(r.exitCode).toBe(1)
  expect(r.stdout).toBe("")
  expect(stderrJSON(r.stderr).code).toBe(code)
}

describe("flag validation", () => {
  test("an unknown search flag is rejected, never silently dropped", async () => {
    await expectRejected(["search", "-q", "php", "--bogus", "x"], "UNKNOWN_FLAG")
  })

  test("an unknown detail flag is rejected", async () => {
    await expectRejected(["detail", "abc123xy", "--bogus"], "UNKNOWN_FLAG")
  })

  test("a search-only flag is rejected on detail", async () => {
    await expectRejected(["detail", "abc123xy", "--query", "php"], "UNKNOWN_FLAG")
  })

  test.each([
    [["--division", "Nope"]],
    [["--experience", "Lead"]],
    [["--experience", "Junior,Wizard"]],
    [["--remote", "sometimes"]],
    [["--format", "xml"]],
  ])("an out-of-vocabulary value is rejected: %p", async (args) => {
    await expectRejected(["search", ...args], "BAD_ARG")
  })

  test.each([
    [["--page", "0"]],
    [["--page", "abc"]],
    [["--page", "1.5"]],
    [["--limit", "0"]],
    [["--jobage", "0"]],
    [["--jobage", "fortnight"]],
    [["--min-salary", "lots"]],
  ])("a bad number is rejected: %p", async (args) => {
    await expectRejected(["search", ...args], "BAD_ARG")
  })

  test("a text flag with no value is rejected", async () => {
    await expectRejected(["search", "--query"], "BAD_ARG")
    await expectRejected(["search", "--location", "--limit", "3"], "BAD_ARG")
  })

  test("--all takes no value", async () => {
    await expectRejected(["search", "--all", "yes"], "BAD_ARG")
  })

  test("--all cannot be combined with --page", async () => {
    await expectRejected(["search", "--all", "--page", "2"], "CONFLICTING_PAGE_FLAGS")
  })

  test("detail does not offer the table format", async () => {
    const r = await runCLI(["detail", "abc123xy", "--format", "table"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
    expect(stderrJSON(r.stderr).error).toContain("json or plain")
  })

  test("detail without an id exits 1", async () => {
    await expectRejected(["detail"], "NO_ID")
  })

  test("detail refuses an id on another host before any request", async () => {
    await expectRejected(["detail", "https://evil.example/o/abc123xy"], "BAD_ID")
  })

  test("an unknown command exits 1", async () => {
    await expectRejected(["browse"], "BAD_CMD")
  })

  test("no command prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("USAGE")
  })

  test("--help prints usage and exits 0", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("SEARCH FLAGS")
  })

  test("stray positional arguments are rejected with a pointer to -q", async () => {
    const r = await runCLI(["search", "PHP", "Symfony"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
    expect(stderrJSON(r.stderr).error).toContain("-q")
    const q = await runCLI(["search", "-q", "php", "Symfony"])
    expect(q.exitCode).toBe(1)
    expect(stderrJSON(q.stderr).code).toBe("BAD_ARG")
    const d = await runCLI(["detail", "12345", "extra"])
    expect(d.exitCode).toBe(1)
    expect(stderrJSON(d.stderr).code).toBe("BAD_ARG")
  })
})
