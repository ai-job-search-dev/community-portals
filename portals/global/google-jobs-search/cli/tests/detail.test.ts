import { afterEach, describe, expect, test } from "bun:test"
import { FIXTURE_DATASET_ID, TEST_TOKEN, parseJSON, runCLI, startFakeApify, successHandler } from "./helpers"

// `detail` reads one record from an already-finished run's dataset. It must not
// start a new run, and it must reject a malformed id before any request.

const FAKES: Array<{ close: () => void }> = []
afterEach(() => {
  while (FAKES.length) FAKES.pop()!.close()
})

const env = (origin: string) => ({ APIFY_API_TOKEN: TEST_TOKEN, GOOGLE_JOBS_SEARCH_API_URL: origin })

interface DetailOutput {
  id: string
  title: string
  company: string
  location: string
  description: string
  apply_options: Array<{ title: string; link: string }>
}

describe("detail success", () => {
  test("reads offset 0 and prints JSON without starting a run", async () => {
    const server = startFakeApify(successHandler)
    FAKES.push(server)

    const result = await runCLI(["detail", `${FIXTURE_DATASET_ID}:0`], env(server.origin))
    expect(result.stderr).toBe("")
    expect(result.exitCode).toBe(0)

    const job = parseJSON<DetailOutput>(result)
    expect(job.id).toBe(`${FIXTURE_DATASET_ID}:0`)
    expect(job.title).toBe("Part-Time Full Stack Software Engineer - AI Trainer")
    expect(job.company).toBe("DataAnnotation")

    // Exactly one dataset read, no Actor run.
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0].path).toBe(`/datasets/${FIXTURE_DATASET_ID}/items`)
    expect(server.requests[0].url.searchParams.get("offset")).toBe("0")
    expect(server.requests[0].url.searchParams.get("limit")).toBe("1")
    expect(server.requests.some((r) => r.method === "POST")).toBe(false)
  })

  test("plain output carries the title, salary, work mode and apply links", async () => {
    const server = startFakeApify(successHandler)
    FAKES.push(server)

    // Offset 1 carries a salary and a remote work mode in the fixture.
    const result = await runCLI(["detail", `${FIXTURE_DATASET_ID}:1`, "--format", "plain"], env(server.origin))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("AI Coding Trainer (Part-Time Software Engineer, Remote)")
    expect(result.stdout).toContain("Salary: 50–100 an hour")
    expect(result.stdout).toContain("Work mode: remote")
    expect(result.stdout).toContain("Apply on MindPal: https://mindpal.co/jobs/140326")
    expect(result.stdout).toContain(`id: ${FIXTURE_DATASET_ID}:1`)
  })
})

describe("detail id validation", () => {
  for (const bad of ["nocolon", "dataset:abc", "dataset:-1", ":5", "dataset:1:2", "a b:1"]) {
    test(`"${bad}" exits 1 with BAD_ID and makes no request`, async () => {
      const server = startFakeApify(successHandler)
      FAKES.push(server)
      const result = await runCLI(["detail", bad], env(server.origin))
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe("")
      expect(JSON.parse(result.stderr).code).toBe("BAD_ID")
      expect(server.requests).toHaveLength(0)
    })
  }
})

describe("detail not found", () => {
  test("an empty dataset page exits 1 with NOT_FOUND", async () => {
    const server = startFakeApify(async (request) => {
      if (request.path.includes("/datasets/")) return { status: 200, body: "[]" }
      return successHandler(request)
    })
    FAKES.push(server)
    const result = await runCLI(["detail", `${FIXTURE_DATASET_ID}:99`], env(server.origin))
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("NOT_FOUND")
  })
})

describe("detail missing token", () => {
  test("an unset token exits 1 with MISSING_TOKEN before any request", async () => {
    const server = startFakeApify(successHandler)
    FAKES.push(server)
    const result = await runCLI(["detail", `${FIXTURE_DATASET_ID}:0`], {
      APIFY_API_TOKEN: undefined,
      GOOGLE_JOBS_SEARCH_API_URL: server.origin,
    })
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("MISSING_TOKEN")
    expect(server.requests).toHaveLength(0)
  })
})
