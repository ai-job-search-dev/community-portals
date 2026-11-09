import { describe, expect, test } from "bun:test"
import { FETCH_FIXTURE, runCLI } from "./helpers.js"

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

  test("--page beyond 1 is refused rather than silently ignored", async () => {
    const r = await runCLI(["search", "-q", "php", "--page", "2"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("PAGE_UNSUPPORTED")
  })

  test("--page 1 is accepted (offline fixture, no network)", async () => {
    const r = await runCLI(["search", "-q", "php", "--page", "1", "--limit", "1", "--format", "table"], FETCH_FIXTURE)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("Mid Symfony Developer")
  })

  test("a non-numeric --jobage is rejected", async () => {
    const r = await runCLI(["search", "--jobage", "fortnight"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("a value outside a controlled vocabulary is rejected", async () => {
    const r = await runCLI(["search", "--workplace", "zdalnie"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).error).toContain("remote | hybrid | office")
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

  test("a non-positive --jobage is rejected", async () => {
    const r = await runCLI(["search", "--jobage", "0"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("a non-numeric --limit is rejected", async () => {
    const r = await runCLI(["search", "--limit", "many"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("a bad --experience or --employment-type is rejected", async () => {
    for (const args of [["--experience", "wizard"], ["--employment-type", "barter"]]) {
      const r = await runCLI(["search", ...args])
      expect(r.exitCode).toBe(1)
      expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
    }
  })

  test("an unknown flag on detail is rejected", async () => {
    const r = await runCLI(["detail", "abc-php", "--bogus"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("--help prints usage and exits 0", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("SEARCH FLAGS")
  })

  test("a value-taking flag with no value is rejected, not run as an unfiltered search", async () => {
    for (const args of [["--query", "--format", "json"], ["-q"], ["--location"], ["--workplace"], ["--limit"], ["--format"]]) {
      const r = await runCLI(["search", ...args])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toBe("")
      expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
      expect(stderrJSON(r.stderr).error).toContain("requires a value")
    }
  })

  test("--with-salary is a boolean and does not swallow the next token", async () => {
    const r = await runCLI(["search", "--with-salary", "php"])
    expect(r.exitCode).toBe(1)
    // "php" stays positional and is rejected, instead of vanishing as the flag's value
    expect(stderrJSON(r.stderr).error).toContain('unexpected argument "php"')
  })

  test("--with-salary before another flag still works", async () => {
    const r = await runCLI(["search", "--with-salary", "-q", "php", "--limit", "1"], FETCH_FIXTURE)
    expect(r.exitCode).toBe(0)
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

  test("a --category that is not a single safe segment is rejected", async () => {
    for (const c of ["../../api", "a/b", "php?x=1", "%2e%2e"]) {
      const r = await runCLI(["search", "--category", c])
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
