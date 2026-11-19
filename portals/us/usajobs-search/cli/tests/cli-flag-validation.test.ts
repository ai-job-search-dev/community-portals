import { describe, test, expect } from "bun:test"
import { runCLI, runSearchFixture } from "./helpers"

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try { return JSON.parse(stderr) } catch { return {} }
}

describe("USAJobs CLI flag validation", () => {
  describe("numeric flag validation", () => {
    for (const name of ["days", "page", "per-page", "limit"]) {
      test(`--${name} fractional exits 1 with BAD_ARG`, async () => {
        const result = await runCLI(["search", `--${name}`, "1.5"])
        expect(result.exitCode).toBe(1)
        const err = parsedStderr(result.stderr)
        expect(err.code).toBe("BAD_ARG")
        expect(err.error).toMatch(new RegExp(name))
      })

      test(`--${name} zero exits 1 with BAD_ARG`, async () => {
        const result = await runCLI(["search", `--${name}`, "0"])
        expect(result.exitCode).toBe(1)
        expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
      })

      test(`--${name} non-numeric string exits 1 with BAD_ARG`, async () => {
        const result = await runCLI(["search", `--${name}`, "foo"])
        expect(result.exitCode).toBe(1)
        expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
      })
    }

    test("--per-page above 500 exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--per-page", "501"])
      expect(result.exitCode).toBe(1)
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
    })
  })

  describe("unknown flag rejection", () => {
    test("unknown flag exits 1 with UNKNOWN_FLAG", async () => {
      const result = await runCLI(["search", "--bogus-flag", "xyz"])
      expect(result.exitCode).toBe(1)
      const err = parsedStderr(result.stderr)
      expect(err.code).toBe("UNKNOWN_FLAG")
      expect(err.error).toContain("--bogus-flag")
    })

    test("unknown detail flag exits 1 with UNKNOWN_FLAG", async () => {
      const result = await runCLI(["detail", "USGS-DEF-CA-26-00001", "--bogus"])
      expect(result.exitCode).toBe(1)
      expect(parsedStderr(result.stderr).code).toBe("UNKNOWN_FLAG")
    })
  })

  describe("--format validation", () => {
    test("search with unsupported format exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--format", "xml"])
      expect(result.exitCode).toBe(1)
      const err = parsedStderr(result.stderr)
      expect(err.code).toBe("BAD_ARG")
      expect(err.error).toMatch(/format/)
    })

    test("detail with table format exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["detail", "USGS-DEF-CA-26-00001", "--format", "table"])
      expect(result.exitCode).toBe(1)
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
    })
  })

  describe("missing required arguments", () => {
    test("detail without id exits 1 with NO_ID", async () => {
      const result = await runCLI(["detail"])
      expect(result.exitCode).toBe(1)
      expect(parsedStderr(result.stderr).code).toBe("NO_ID")
    })

    test("missing API key causes API_ERROR with helpful message", async () => {
      const proc = Bun.spawn(
        ["bun", "run", "--preload", import.meta.dir + "/no-network.ts", import.meta.dir + "/../src/cli.ts", "search"],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, USAJOBS_API_KEY: "" },
        },
      )
      const [stderr, exitCode] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      expect(exitCode).toBe(1)
      const err = parsedStderr(stderr.trim())
      expect(err.code).toBe("API_ERROR")
      expect(err.error).toContain("USAJOBS_API_KEY")
    })
  })

  describe("empty --keyword rejection", () => {
    test("whitespace-only --keyword exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--keyword", "   "])
      expect(result.exitCode).toBe(1)
      const err = parsedStderr(result.stderr)
      expect(err.code).toBe("BAD_ARG")
    })
  })

  describe("extra positional arguments", () => {
    test("unquoted multi-word search exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "software", "engineer"])
      expect(result.exitCode).toBe(1)
      const err = parsedStderr(result.stderr)
      expect(err.code).toBe("BAD_ARG")
      expect(err.error).toMatch(/quote/)
    })
  })

  describe("valid search with fixture", () => {
    test("search with keyword and location uses them in the API request", async () => {
      const { result, requests } = await runSearchFixture([
        "search", "-q", "software engineer", "-l", "California", "--limit", "2",
      ])
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe("")
      expect(requests).toHaveLength(1)
      expect(requests[0].searchParams.get("Keyword")).toBe("software engineer")
      expect(requests[0].searchParams.get("LocationName")).toBe("California")
      const output = JSON.parse(result.stdout)
      expect(output.meta.count).toBe(2)
      expect(output.results[0].id).toBe("USGS-DEF-CA-26-00001")
    })

    test("--remote sets RemoteIndicator=True in the request", async () => {
      const { requests } = await runSearchFixture(["search", "--remote", "--limit", "1"])
      expect(requests[0].searchParams.get("RemoteIndicator")).toBe("True")
    })

    test("--remote does not consume the following keyword argument", async () => {
      const { result, requests } = await runSearchFixture(["search", "--remote", "-q", "nurse"])
      expect(result.exitCode).toBe(0)
      expect(requests[0].searchParams.get("RemoteIndicator")).toBe("True")
      expect(requests[0].searchParams.get("Keyword")).toBe("nurse")
    })

    test("--days sets DatePosted in the request", async () => {
      const { requests } = await runSearchFixture(["search", "--days", "7", "--limit", "1"])
      expect(requests[0].searchParams.get("DatePosted")).toBe("7")
    })

    test("--per-page sets ResultsPerPage in the request", async () => {
      const { requests } = await runSearchFixture(["search", "--per-page", "50"])
      expect(requests[0].searchParams.get("ResultsPerPage")).toBe("50")
    })

    test("search results have required contract fields", async () => {
      const { result } = await runSearchFixture(["search", "-q", "engineer"])
      const output = JSON.parse(result.stdout)
      const job = output.results[0]
      expect(typeof job.id).toBe("string")
      expect(typeof job.title).toBe("string")
      expect(typeof job.company).toBe("string")
      expect(typeof job.location).toBe("string")
      expect(typeof job.url).toBe("string")
    })
  })
})
