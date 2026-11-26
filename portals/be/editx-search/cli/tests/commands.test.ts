import { describe, expect, test } from "bun:test"
import { parseJSON, runWithFixture, stderrJSON } from "./helpers"

interface SearchJSON {
  meta: { count: number; page: number; total: number | null }
  results: Array<Record<string, unknown>>
}

describe("search through the real CLI (offline fixture)", () => {
  test("sends keyword, location and count; emits the contract shape", async () => {
    const { result, requests } = await runWithFixture(["search", "-q", "python", "-l", "Leuven", "--limit", "3"], {
      file: "search-leuven-python.json",
    })
    const out = parseJSON<SearchJSON>(result)
    expect(requests).toHaveLength(1)
    const params = requests[0].searchParams
    expect(requests[0].pathname).toBe("/api/editx/jobs")
    expect(params.get("keyword")).toBe("python")
    expect(params.get("location")).toBe("Leuven")
    expect(params.get("count")).toBe("50") // a page is always a fixed block of 50
    expect(params.has("page")).toBe(false) // page 1 is the API's page 0, its default

    expect(out.meta).toEqual({ count: 3, page: 1, total: 10 })
    for (const r of out.results) {
      for (const key of ["id", "title", "company", "location", "date", "url"]) expect(r).toHaveProperty(key)
      expect(String(r.url)).toStartWith("https://editx.eu/en/it-jobs/")
      expect(String(r.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(out.results[0]).toMatchObject({
      id: "20750",
      title: "Python Developer | Financial Sector",
      company: "Sander",
      date: "2026-11-17",
      url: "https://editx.eu/en/it-jobs/20750/python-developer-financial-sector",
    })
    expect(result.stdout).not.toContain("recruiter")
  })

  test("--page means the same block of 50 whatever --limit is", async () => {
    const { result, requests } = await runWithFixture(["search", "-q", "python", "--page", "2", "--limit", "10"], {
      file: "search-leuven-python.json",
    })
    expect(result.exitCode).toBe(0)
    expect(requests[0].searchParams.get("page")).toBe("1")
    expect(requests[0].searchParams.get("count")).toBe("50")
  })

  test("--page is 1-indexed for users and 0-indexed on the wire", async () => {
    const { result, requests } = await runWithFixture(["search", "-q", "python", "--page", "3"], { file: "search-leuven-python.json" })
    expect(result.exitCode).toBe(0)
    expect(requests[0].searchParams.get("page")).toBe("2")
    expect(parseJSON<SearchJSON>(result).meta.page).toBe(3)
  })

  test("past the last page: jobs null is an empty page with unknown total, not 'no matches'", async () => {
    const { result } = await runWithFixture(["search", "-q", "python", "--page", "10"], { file: "search-past-end.json" })
    const out = parseJSON<SearchJSON>(result)
    expect(out.results).toEqual([])
    expect(out.meta).toEqual({ count: 0, page: 10, total: null })
  })

  test("--limit above 50 asks for 50 and warns after stdout", async () => {
    const { result, requests } = await runWithFixture(["search", "-q", "python", "--limit", "80"], { file: "search-leuven-python.json" })
    expect(requests[0].searchParams.get("count")).toBe("50")
    expect(parseJSON<SearchJSON>(result).meta.count).toBe(3)
    expect(stderrJSON(result).map((w) => w.code)).toEqual(["LIMIT_CAPPED"])
  })

  test("--jobage drops older postings client-side and says so", async () => {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10) + " 08:00:00"
    const body = {
      total: 3,
      page: 0,
      count: 50,
      jobs: [
        { id: "1", title: "Fresh", onlineDate: { value: day(2) } },
        { id: "2", title: "Old", onlineDate: { value: day(400) } },
        { id: "3", title: "Undated" },
      ],
    }
    const { result } = await runWithFixture(["search", "-q", "python", "--jobage", "30"], { body })
    expect(parseJSON<SearchJSON>(result).results.map((r) => r.title)).toEqual(["Fresh"])
    expect(stderrJSON(result).map((w) => w.code)).toEqual(["JOBAGE_CLIENT_SIDE"])
  })

  test("one malformed entry is skipped, the rest still come through", async () => {
    const body = { total: 3, page: 0, count: 50, jobs: [null, {}, { id: "abc" }, { id: "42", title: "Valid" }] }
    const out = parseJSON<SearchJSON>((await runWithFixture(["search", "-q", "python"], { body })).result)
    expect(out.results.map((r) => r.id)).toEqual(["42"])
  })

  test("a page where every entry is malformed fails instead of reading as zero results", async () => {
    const body = { total: 12, page: 0, count: 50, jobs: [{ id: "abc", title: "x" }, { id: null }, null] }
    const { result } = await runWithFixture(["search", "-q", "python"], { body })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(stderrJSON(result)[0].code).toBe("SEARCH_FAILED")
  })

  test("an unexpected response shape fails loudly instead of reading as zero results", async () => {
    const { result } = await runWithFixture(["search", "-q", "python"], { body: { total: 5, jobs: { items: [] } } })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(stderrJSON(result)[0].code).toBe("SEARCH_FAILED")
  })

  test("a recruiter object in the response never reaches the output", async () => {
    const body = {
      total: 1,
      jobs: [{ id: "7", title: "Dev", recruiter: { firstname: "Testy", lastname: "M.", linkedin: "https://www.linkedin.com/in/testy-m" } }],
    }
    for (const format of ["json", "table", "plain"]) {
      const { result } = await runWithFixture(["search", "-q", "dev", "--format", format], { body })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("Dev")
      expect(result.stdout).not.toMatch(/Testy|linkedin|recruiter/i)
    }
  })

  test("table and plain formats", async () => {
    const table = (await runWithFixture(["search", "-q", "python", "--format", "table"], { file: "search-leuven-python.json" })).result
    expect(table.exitCode).toBe(0)
    expect(table.stdout.split("\n")[0]).toMatch(/^ID\s+TITLE\s+COMPANY\s+LOCATION\s+DATE/)
    expect(table.stdout).toContain("20750")

    const plain = (await runWithFixture(["search", "-q", "python", "--format", "plain"], { file: "search-leuven-python.json" })).result
    expect(plain.exitCode).toBe(0)
    expect(plain.stdout).toContain("id: 20750")
    expect(plain.stdout).toContain("https://editx.eu/en/it-jobs/20750/")
  })

  test("a missing search endpoint (404) fails as SEARCH_FAILED on stderr, not as zero results", async () => {
    // The retry loop for 429/5xx is covered in retry-backoff.test.ts, where its
    // delays can be stubbed; a real child process would sleep through them.
    const { result } = await runWithFixture(["search", "-q", "python"], { status: 404, body: "Not Found" })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(stderrJSON(result)[0].code).toBe("SEARCH_FAILED")
  })
})

describe("detail through the real CLI (offline fixture)", () => {
  test("json: cleaned sections, apply link, no recruiter data", async () => {
    const { result, requests } = await runWithFixture(["detail", "https://editx.eu/en/it-jobs/20750/python-developer-financial-sector"], {
      file: "detail-20750.json",
    })
    const job = parseJSON<Record<string, unknown>>(result)
    expect(requests[0].pathname).toBe("/api/editx/job/20750")
    expect(job).toMatchObject({
      id: "20750",
      title: "Python Developer | Financial Sector",
      status: "online",
      open_to_apply: true,
      languages: ["en"],
      apply_url: "https://www.wearesander.com/en/jobs/python-developer-financial-sector/89480",
    })
    const description = String(job.description)
    expect(description).toStartWith("The role\n")
    expect(description).toContain("\n\nProfile\n")
    expect(description).not.toMatch(/<[a-z/][^>]*>/i)
    expect(result.stdout).not.toContain("recruiter")
  })

  test("a recruiter object in the detail response never reaches the output", async () => {
    const body = {
      id: "7",
      title: "Dev",
      role: "<p>Build things</p>",
      recruiter: { firstname: "Testy", lastname: "M.", linkedin: "https://www.linkedin.com/in/testy-m" },
    }
    for (const format of ["json", "plain"]) {
      const { result } = await runWithFixture(["detail", "7", "--format", format], { body })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("Build things")
      expect(result.stdout).not.toMatch(/Testy|linkedin|recruiter/i)
    }
  })

  for (const bad of [{ id: null, title: "x" }, { id: "abc", title: "x" }, { title: "no id" }, ["not", "a", "job"], "a string"]) {
    test(`a 200 detail body without a numeric id (${JSON.stringify(bad)}) fails as DETAIL_FAILED`, async () => {
      const { result } = await runWithFixture(["detail", "20750"], { body: bad })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe("")
      expect(stderrJSON(result)[0].code).toBe("DETAIL_FAILED")
    })
  }

  test("plain format", async () => {
    const { result } = await runWithFixture(["detail", "20750", "--format", "plain"], { file: "detail-20750.json" })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Functions: Developer / Programmer")
    expect(result.stdout.split("\n")[0]).toBe("Python Developer | Financial Sector")
    expect(result.stdout).toContain("URL: https://editx.eu/en/it-jobs/20750/")
    expect(result.stdout).toContain("id: 20750")
  })

  test("a 404 (the API's JSON 'Not Found') is NOT_FOUND with exit 1", async () => {
    const { result } = await runWithFixture(["detail", "99999999"], { status: 404, body: "Not Found" })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(stderrJSON(result)[0].code).toBe("NOT_FOUND")
  })
})
