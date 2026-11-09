import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

// Every case exits before any network request is made.
const errorCode = async (args: string[]) => {
  const r = await runCLI(args)
  expect(r.exitCode).toBe(1)
  expect(r.stdout).toBe("")
  return JSON.parse(r.stderr).code as string
}

describe("flag validation", () => {
  test("unknown flag", async () => expect(await errorCode(["search", "-q", "PHP", "--bogus", "x"])).toBe("UNKNOWN_FLAG"))
  test("search needs a filter", async () => expect(await errorCode(["search"])).toBe("NO_FILTER"))
  test("empty query value", async () => expect(await errorCode(["search", "-q"])).toBe("BAD_ARG"))
  test("bad level", async () => expect(await errorCode(["search", "--level", "god"])).toBe("BAD_ARG"))
  test("unknown city", async () => expect(await errorCode(["search", "-l", "Koszalin"])).toBe("BAD_ARG"))
  test("bad format", async () => expect(await errorCode(["search", "-q", "PHP", "--format", "xml"])).toBe("BAD_ARG"))
  test("bad jobage", async () => expect(await errorCode(["search", "-q", "PHP", "--jobage", "0"])).toBe("BAD_ARG"))
  test("all + page", async () =>
    expect(await errorCode(["search", "-q", "PHP", "--all", "--page", "2"])).toBe("CONFLICTING_PAGE_FLAGS"))
  test("title words + page", async () =>
    expect(await errorCode(["search", "-q", "PHP architect", "--page", "2"])).toBe("CONFLICTING_PAGE_FLAGS"))
  test("detail without id", async () => expect(await errorCode(["detail"])).toBe("NO_ID"))
  test("detail with foreign host", async () =>
    expect(await errorCode(["detail", "https://evil.io/companies/jobs/260906"])).toBe("BAD_ID"))
  test("unknown command", async () => expect(await errorCode(["frobnicate"])).toBe("BAD_CMD"))
})

describe("flag validation (more)", () => {
  test("unknown flag on detail", async () => expect(await errorCode(["detail", "260906", "--bogus"])).toBe("UNKNOWN_FLAG"))
  test("search-only flag on detail", async () => expect(await errorCode(["detail", "260906", "--level", "senior"])).toBe("UNKNOWN_FLAG"))
  test("empty role value", async () => expect(await errorCode(["search", "--role"])).toBe("BAD_ARG"))
  test("--all takes no value", async () => expect(await errorCode(["search", "-q", "PHP", "--all", "yes"])).toBe("BAD_ARG"))
  test("--dates takes no value", async () => expect(await errorCode(["search", "-q", "PHP", "--dates", "yes"])).toBe("BAD_ARG"))
  test.each([["--page", "0"], ["--page", "abc"], ["--limit", "0"], ["--limit", "1.5"], ["--jobage", "fortnight"]])(
    "bad number %s %s",
    async (flag, value) => expect(await errorCode(["search", "-q", "PHP", flag, value])).toBe("BAD_ARG"),
  )
  test("detail rejects the table format", async () =>
    expect(await errorCode(["detail", "260906", "--format", "table"])).toBe("BAD_ARG"))
  test("detail rejects a malformed id", async () => expect(await errorCode(["detail", "not-an-id"])).toBe("BAD_ID"))

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
})
