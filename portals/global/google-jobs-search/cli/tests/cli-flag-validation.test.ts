import { afterEach, describe, expect, test } from "bun:test"
import { TEST_TOKEN, runCLI, startFakeApify, successHandler } from "./helpers"

// Flag validation runs before any request. Each case asserts exit 1, a JSON
// error on stderr, empty stdout, and zero requests, so a bad flag can never
// spend quota.

const FAKES: Array<{ close: () => void }> = []
afterEach(() => {
  while (FAKES.length) FAKES.pop()!.close()
})

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr)
  } catch {
    return {}
  }
}

describe("flag validation", () => {
  const cases: Array<{ args: string[]; code: string }> = [
    { args: ["search"], code: "NO_QUERY" },
    { args: ["search", "-q"], code: "NO_QUERY" },
    { args: ["search", "-q", "   "], code: "NO_QUERY" },
    { args: ["search", "-q", "x", "-l", "  "], code: "BAD_ARG" },
    { args: ["search", "-q", "x", "--country", "fr"], code: "BAD_ARG" },
    { args: ["search", "-q", "x", "--format", "xml"], code: "BAD_ARG" },
    { args: ["search", "-q", "x", "--jobage", "0"], code: "BAD_ARG" },
    { args: ["search", "-q", "x", "--jobage", "1.5"], code: "BAD_ARG" },
    { args: ["search", "-q", "x", "--jobage", "foo"], code: "BAD_ARG" },
    { args: ["search", "-q", "x", "--page", "0"], code: "BAD_ARG" },
    { args: ["search", "-q", "x", "--limit", "abc"], code: "BAD_ARG" },
    { args: ["search", "-q", "x", "--bogus", "1"], code: "UNKNOWN_FLAG" },
    { args: ["search", "-q", "x", "--remote", "yes"], code: "BAD_ARG" },
    { args: ["search", "-q", "engineer", "typo"], code: "BAD_ARG" },
    { args: ["detail", "a:1", "typo"], code: "BAD_ARG" },
    { args: ["detail"], code: "NO_ID" },
    { args: ["detail", "a:1", "--format", "table"], code: "BAD_ARG" },
    { args: ["unknown-cmd"], code: "BAD_CMD" },
  ]

  for (const { args, code } of cases) {
    test(`${JSON.stringify(args)} exits 1 with ${code} and makes no request`, async () => {
      const server = startFakeApify(successHandler)
      FAKES.push(server)
      const result = await runCLI(args, { APIFY_API_TOKEN: TEST_TOKEN, GOOGLE_JOBS_SEARCH_API_URL: server.origin })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe("")
      const parsed = parsedStderr(result.stderr)
      expect(parsed.code).toBe(code)
      // A code with no human-readable message is not a complete contract error.
      expect(typeof parsed.error).toBe("string")
      expect(parsed.error!.length).toBeGreaterThan(0)
      expect(server.requests).toHaveLength(0)
    })
  }
})

describe("help", () => {
  test("search --help prints usage and exits 0", async () => {
    const result = await runCLI(["search", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("google-jobs-cli")
  })

  test("no command prints usage and exits 1", async () => {
    const result = await runCLI([])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("google-jobs-cli")
  })
})
