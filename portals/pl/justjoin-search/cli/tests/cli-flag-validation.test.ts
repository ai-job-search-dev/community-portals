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

  test("--page beyond 1 is refused rather than silently ignored", async () => {
    const r = await runCLI(["search", "-q", "php", "--page", "2"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("PAGE_UNSUPPORTED")
  })

  test("--page 1 is accepted", async () => {
    const r = await runCLI(["search", "-q", "php", "--page", "1", "--limit", "1", "--format", "table"])
    expect(r.exitCode).toBe(0)
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
})
