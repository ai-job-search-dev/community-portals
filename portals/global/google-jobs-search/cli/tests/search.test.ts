import { afterEach, describe, expect, test } from "bun:test"
import { FIXTURE_DATASET_ID, FIXTURE_RUN_ID, TEST_TOKEN, parseJSON, runCLI, startFakeApify, successHandler } from "./helpers"

const FAKES: Array<{ close: () => void }> = []
afterEach(() => {
  while (FAKES.length) FAKES.pop()!.close()
})

function fake(handler = successHandler) {
  const server = startFakeApify(handler)
  FAKES.push(server)
  return server
}

const env = (origin: string) => ({
  APIFY_API_TOKEN: TEST_TOKEN,
  GOOGLE_JOBS_SEARCH_API_URL: origin,
})

interface SearchOutput {
  meta: { count: number; page: number; run_id: string; dataset_id: string }
  results: Array<{
    id: string
    title: string
    company: string
    location: string
    date: string | null
    url: string | null
    description: string | null
    salary: string | null
    apply_options: Array<{ title: string | null; link: string }>
  }>
}

describe("search success", () => {
  test("exits 0 and returns the three captured records", async () => {
    const server = fake()
    const result = await runCLI(["search", "-q", "software engineer", "-l", "San Francisco, CA"], env(server.origin))

    expect(result.stderr).toBe("")
    expect(result.exitCode).toBe(0)
    const output = parseJSON<SearchOutput>(result)
    expect(output.meta.count).toBe(3)
    expect(output.meta.page).toBe(1)
    expect(output.meta.run_id).toBe(FIXTURE_RUN_ID)
    expect(output.meta.dataset_id).toBe(FIXTURE_DATASET_ID)
    expect(output.results).toHaveLength(3)

    const first = output.results[0]
    expect(first.id).toBe(`${FIXTURE_DATASET_ID}:0`)
    expect(first.title).toBe("Part-Time Full Stack Software Engineer - AI Trainer")
    expect(first.company).toBe("DataAnnotation")
    expect(first.location).toBe("San Francisco, CA")
    expect(first.date).toBe("2026-11-26")
    expect(first.url).toBe(
      "https://salutemyjob.com/jobs/part-time-full-stack-software-engineer-ai-trainer-san-francisco-california/3090084665-2/?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
    )
    expect(first.apply_options[0].title).toBe("Apply on SaluteMyJob")
  })

  test("a captured record without an apply link has a null url, not an omitted field", async () => {
    const server = fake(async (request) => {
      if (request.path.includes("/datasets/")) {
        return { status: 200, body: JSON.stringify([{ title: "No link", company: "Acme" }]) }
      }
      return successHandler(request)
    })
    const result = await runCLI(["search", "-q", "x"], env(server.origin))
    expect(result.exitCode).toBe(0)
    const output = parseJSON<SearchOutput>(result)
    expect(output.results[0]).toMatchObject({ url: null, date: null, salary: null })
  })
})

describe("request shape", () => {
  test("POSTs the Actor input with the bearer token and no token in any URL", async () => {
    const server = fake()
    const result = await runCLI(
      ["search", "-q", "data engineer", "-l", "Austin, TX", "--country", "gb", "--jobage", "7", "--remote"],
      env(server.origin),
    )
    expect(result.exitCode).toBe(0)

    const start = server.requests.find((r) => r.method === "POST")
    expect(start).toBeDefined()
    expect(start!.path).toBe("/acts/krammer~google-jobs-scraper/runs")
    expect(start!.url.searchParams.get("waitForFinish")).toBe("60")
    expect(start!.headers.get("authorization")).toBe(`Bearer ${TEST_TOKEN}`)

    const body = JSON.parse(start!.body)
    expect(body.queries).toEqual(["data engineer"])
    expect(body.locations).toEqual(["Austin, TX"])
    expect(body.country).toBe("gb")
    expect(body.datePosted).toBe("7d")
    expect(body.maxResultsPerSearch).toBe(10)
    expect(body.remoteOnly).toBe(true)

    // No request puts the token in a URL.
    for (const request of server.requests) {
      expect(request.url.toString()).not.toContain(TEST_TOKEN)
    }
  })

  test("a query without a location sends no locations field", async () => {
    const server = fake()
    await runCLI(["search", "-q", "paralegal"], env(server.origin))
    const start = JSON.parse(server.requests.find((r) => r.method === "POST")!.body)
    expect(start.locations).toBeUndefined()
    expect(start.remoteOnly).toBeUndefined()
    expect(start.country).toBe("us")
  })

  test("--remote alone sets remoteOnly true without a location", async () => {
    const server = fake()
    await runCLI(["search", "-q", "engineer", "--remote"], env(server.origin))
    const start = JSON.parse(server.requests.find((r) => r.method === "POST")!.body)
    expect(start.remoteOnly).toBe(true)
  })
})

describe("--jobage mapping", () => {
  for (const [jobage, expected] of [
    ["1", "24h"],
    ["2", "3d"],
    ["3", "3d"],
    ["4", "7d"],
    ["7", "7d"],
    ["8", "30d"],
    ["30", "30d"],
    ["31", "any"],
  ] as const) {
    test(`--jobage ${jobage} sends datePosted=${expected}`, async () => {
      const server = fake()
      await runCLI(["search", "-q", "x", "--jobage", jobage], env(server.origin))
      const start = JSON.parse(server.requests.find((r) => r.method === "POST")!.body)
      expect(start.datePosted).toBe(expected)
    })
  }

  test("omitting --jobage sends datePosted=any", async () => {
    const server = fake()
    await runCLI(["search", "-q", "x"], env(server.origin))
    const start = JSON.parse(server.requests.find((r) => r.method === "POST")!.body)
    expect(start.datePosted).toBe("any")
  })
})

describe("pagination", () => {
  test("--page 2 --limit 5 asks for 10 results and reads dataset offset 5", async () => {
    const server = fake()
    const result = await runCLI(["search", "-q", "x", "--page", "2", "--limit", "5"], env(server.origin))
    expect(result.exitCode).toBe(0)

    const start = JSON.parse(server.requests.find((r) => r.method === "POST")!.body)
    expect(start.maxResultsPerSearch).toBe(10)

    const dataset = server.requests.find((r) => r.path.includes("/datasets/"))!
    expect(dataset.url.searchParams.get("offset")).toBe("5")
    expect(dataset.url.searchParams.get("limit")).toBe("5")

    const output = parseJSON<SearchOutput>(result)
    expect(output.meta.page).toBe(2)
  })

  test("--page 41 --limit 5 exits 1 with PAGE_TOO_DEEP and makes no request", async () => {
    const server = fake()
    const result = await runCLI(["search", "-q", "x", "--page", "41", "--limit", "5"], env(server.origin))
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe("PAGE_TOO_DEEP")
    expect(server.requests).toHaveLength(0)
  })

  test("--limit above 200 exits 1 with BAD_ARG and makes no request", async () => {
    const server = fake()
    const result = await runCLI(["search", "-q", "x", "--limit", "201"], env(server.origin))
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_ARG")
    expect(server.requests).toHaveLength(0)
  })
})

describe("run polling", () => {
  test("a RUNNING start is polled once and the follow-up SUCCEEDED is read", async () => {
    let polls = 0
    const server = startFakeApify(async (request) => {
      if (request.path.includes("/acts/krammer~google-jobs-scraper/runs")) {
        return { status: 200, body: runWithStatusHere("RUNNING") }
      }
      if (request.path.includes("/actor-runs/")) {
        polls++
        return { status: 200, body: runWithStatusHere("SUCCEEDED", "Done.") }
      }
      return successHandler(request)
    })
    FAKES.push(server)

    const result = await runCLI(["search", "-q", "x"], env(server.origin))
    expect(result.exitCode).toBe(0)
    expect(polls).toBe(1)
    expect(server.requests.filter((r) => r.path.includes("/actor-runs/"))).toHaveLength(1)
  })

  test("a run that never reaches a terminal state exits 1 with RUN_TIMEOUT naming the run", async () => {
    const server = startFakeApify(async (request) => {
      if (request.path.includes("/runs") || request.path.includes("/actor-runs/")) {
        return { status: 200, body: runWithStatusHere("RUNNING") }
      }
      return successHandler(request)
    })
    FAKES.push(server)

    const result = await runCLI(["search", "-q", "x"], env(server.origin))
    expect(result.exitCode).toBe(1)
    const error = JSON.parse(result.stderr)
    expect(error.code).toBe("RUN_TIMEOUT")
    expect(error.error).toContain(FIXTURE_RUN_ID)
    // The start request plus five polls.
    expect(server.requests.filter((r) => r.path.includes("/actor-runs/"))).toHaveLength(5)
  })

  test("a FAILED run exits 1 with RUN_FAILED and the statusMessage", async () => {
    const server = startFakeApify(async () => ({
      status: 200,
      body: runWithStatusHere("FAILED", "Proxy connection refused"),
    }))
    FAKES.push(server)

    const result = await runCLI(["search", "-q", "x"], env(server.origin))
    expect(result.exitCode).toBe(1)
    const error = JSON.parse(result.stderr)
    expect(error.code).toBe("RUN_FAILED")
    expect(error.error).toContain("FAILED")
    expect(error.error).toContain("Proxy connection refused")
  })
})

/** A run envelope built in this file to keep the test's status explicit. */
function runWithStatusHere(status: string, statusMessage = ""): string {
  return JSON.stringify({
    data: { id: FIXTURE_RUN_ID, status, statusMessage, defaultDatasetId: FIXTURE_DATASET_ID },
  })
}

describe("plain format", () => {
  test("an empty page prints an explicit No results. line", async () => {
    const server = startFakeApify(async (request) => {
      if (request.path.includes("/datasets/")) return { status: 200, body: "[]" }
      return successHandler(request)
    })
    FAKES.push(server)
    const result = await runCLI(["search", "-q", "x", "--format", "plain"], env(server.origin))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("No results.")
  })

  test("CRLF and a lone CR in listing text are normalized to LF", async () => {
    const server = startFakeApify(async (request) => {
      if (request.path.includes("/datasets/")) {
        return { status: 200, body: JSON.stringify([{ title: "A\r\nB", company: "C\rD" }]) }
      }
      return successHandler(request)
    })
    FAKES.push(server)
    const result = await runCLI(["search", "-q", "x", "--format", "plain"], env(server.origin))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain("\r")
    expect(result.stdout).toContain("  CD · — · —")
  })

  test("a javascript: apply link is dropped and url stays null", async () => {
    const server = startFakeApify(async (request) => {
      if (request.path.includes("/datasets/")) {
        return {
          status: 200,
          body: JSON.stringify([
            {
              title: "X",
              apply_options: [
                { title: "evil", link: "javascript:alert(1)" },
                { title: "good", link: "https://example.com/apply" },
              ],
            },
          ]),
        }
      }
      return successHandler(request)
    })
    FAKES.push(server)
    const result = await runCLI(["search", "-q", "x"], env(server.origin))
    expect(result.exitCode).toBe(0)
    const output = parseJSON<SearchOutput>(result)
    expect(output.results[0].apply_options).toEqual([{ title: "good", link: "https://example.com/apply" }])
    expect(output.results[0].url).toBe("https://example.com/apply")
  })

  test("only a non-http apply link leaves apply_options empty and url null", async () => {
    const server = startFakeApify(async (request) => {
      if (request.path.includes("/datasets/")) {
        return { status: 200, body: JSON.stringify([{ title: "X", apply_options: [{ link: "javascript:1" }, { link: "data:text/html,x" }] }]) }
      }
      return successHandler(request)
    })
    FAKES.push(server)
    const result = await runCLI(["search", "-q", "x"], env(server.origin))
    const output = parseJSON<SearchOutput>(result)
    expect(output.results[0].apply_options).toEqual([])
    expect(output.results[0].url).toBeNull()
  })
})

describe("malformed envelopes", () => {
  test("a JSON null run response exits 1 with HTTP_ERROR, not a crash", async () => {
    const server = startFakeApify(async (request) => {
      if (request.path.includes("/runs")) return { status: 200, body: "null" }
      return successHandler(request)
    })
    FAKES.push(server)
    const result = await runCLI(["search", "-q", "x"], env(server.origin))
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("HTTP_ERROR")
  })
})

describe("HTTP error mapping", () => {
  test("401 exits 1 with AUTH", async () => {
    const server = startFakeApify(async () => ({ status: 401, body: '{"error":"unauthorized"}' }))
    FAKES.push(server)
    const result = await runCLI(["search", "-q", "x"], env(server.origin))
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("AUTH")
  })

  test("403 exits 1 with AUTH", async () => {
    const server = startFakeApify(async () => ({ status: 403, body: "" }))
    FAKES.push(server)
    const result = await runCLI(["search", "-q", "x"], env(server.origin))
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("AUTH")
  })

  test("402 exits 1 with QUOTA", async () => {
    const server = startFakeApify(async () => ({ status: 402, body: '{"error":"payment required"}' }))
    FAKES.push(server)
    const result = await runCLI(["search", "-q", "x"], env(server.origin))
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("QUOTA")
  })

  test("429 then success: the retry succeeds", async () => {
    let calls = 0
    const server = startFakeApify(async (request) => {
      calls++
      if (calls === 1) return { status: 429, body: "" }
      return successHandler(request)
    })
    FAKES.push(server)
    const result = await runCLI(["search", "-q", "x"], env(server.origin))
    expect(result.exitCode).toBe(0)
    expect(calls).toBeGreaterThanOrEqual(2)
  })
})

describe("missing token", () => {
  test("an unset APIFY_API_TOKEN exits 1 with MISSING_TOKEN and makes no request", async () => {
    const server = startFakeApify(successHandler)
    FAKES.push(server)
    const result = await runCLI(["search", "-q", "x"], {
      APIFY_API_TOKEN: undefined,
      GOOGLE_JOBS_SEARCH_API_URL: server.origin,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    const error = JSON.parse(result.stderr)
    expect(error.code).toBe("MISSING_TOKEN")
    expect(error.error).toContain("APIFY_API_TOKEN")
    expect(server.requests).toHaveLength(0)
  })

  test("a blank APIFY_API_TOKEN is treated as unset", async () => {
    const server = startFakeApify(successHandler)
    FAKES.push(server)
    const result = await runCLI(["search", "-q", "x"], {
      APIFY_API_TOKEN: "   ",
      GOOGLE_JOBS_SEARCH_API_URL: server.origin,
    })
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("MISSING_TOKEN")
    expect(server.requests).toHaveLength(0)
  })
})
