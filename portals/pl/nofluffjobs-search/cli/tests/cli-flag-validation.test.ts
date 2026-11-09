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
})
