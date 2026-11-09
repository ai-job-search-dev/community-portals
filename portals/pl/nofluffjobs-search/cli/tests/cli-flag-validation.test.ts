import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

function stderrJSON(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr) as { error: string; code: string }
}

describe("flag validation", () => {
  test("an unknown flag exits 1 with a JSON error on stderr", async () => {
    const r = await runCLI(["search", "-q", "php", "--bogus", "x"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(stderrJSON(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("--all with --page exits 1 with CONFLICTING_PAGE_FLAGS", async () => {
    const r = await runCLI(["search", "-q", "php", "--all", "--page", "2"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("CONFLICTING_PAGE_FLAGS")
  })

  test("--all takes no value", async () => {
    const r = await runCLI(["search", "--all", "yes"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("a non-numeric --jobage is rejected", async () => {
    const r = await runCLI(["search", "--jobage", "fortnight", "--limit", "5"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("a zero or negative --page is rejected", async () => {
    const r = await runCLI(["search", "--page", "0"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("a seniority outside the vocabulary is rejected", async () => {
    const r = await runCLI(["search", "--seniority", "wizard"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).error).toContain("trainee | junior | mid | senior | expert")
  })

  test("detail without an id exits 1", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("NO_ID")
  })

  test("an unknown command exits 1", async () => {
    const r = await runCLI(["browse"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_CMD")
  })

  test("no command prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("USAGE")
  })

  test("an unknown flag on detail is rejected", async () => {
    const r = await runCLI(["detail", "abc-php", "--bogus"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("a non-numeric --limit is rejected", async () => {
    const r = await runCLI(["search", "--limit", "many"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("--help prints usage and exits 0", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("SEARCH FLAGS")
  })

  test("a value-taking flag with no value is rejected, not run as an unfiltered search", async () => {
    for (const args of [["--query", "--format", "json"], ["-q"], ["--location"], ["--seniority"], ["--limit"], ["--format"]]) {
      const r = await runCLI(["search", ...args])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toBe("")
      expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
      expect(stderrJSON(r.stderr).error).toContain("requires a value")
    }
  })

  test("--dates and --all are booleans and do not swallow the next token", async () => {
    for (const flag of ["--dates", "--all"]) {
      const r = await runCLI(["search", flag, "php"])
      expect(r.exitCode).toBe(1)
      expect(stderrJSON(r.stderr).error).toContain('unexpected argument "php"')
    }
  })

  test("stray positional arguments are rejected with a pointer to -q", async () => {
    const r = await runCLI(["search", "PHP", "Symfony"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
    expect(stderrJSON(r.stderr).error).toContain("-q")
    const d = await runCLI(["detail", "abc-php", "extra"])
    expect(d.exitCode).toBe(1)
    expect(stderrJSON(d.stderr).code).toBe("BAD_ARG")
  })

  test("an unknown --format is rejected for search and detail", async () => {
    const s = await runCLI(["search", "--format", "xml"])
    expect(s.exitCode).toBe(1)
    expect(s.stdout).toBe("")
    expect(stderrJSON(s.stderr).code).toBe("BAD_ARG")
    expect(stderrJSON(s.stderr).error).toContain("json | table | plain")
    const d = await runCLI(["detail", "abc-php", "--format", "table"])
    expect(d.exitCode).toBe(1)
    expect(stderrJSON(d.stderr).error).toContain("json | plain")
  })

  test("integer flags must be whole numbers, not numeric prefixes", async () => {
    for (const args of [["--jobage", "1.5"], ["--limit", "10oops"], ["--page", "1x"], ["--limit", "1e3"], ["--limit", "99999999999999999999"]]) {
      const r = await runCLI(["search", ...args])
      expect(r.exitCode).toBe(1)
      expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
    }
  })

  test("detail refuses a path-escaping slug before any request", async () => {
    const r = await runCLI(["detail", "../api"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })
})
