import { afterEach, describe, expect, test } from "bun:test"
import { runDetail } from "../src/commands/detail.ts"
import { runSearch, type SearchOpts } from "../src/commands/search.ts"

// Offline: the output contract of `search` and `detail` against a mocked API.

const originalFetch = globalThis.fetch
const originalStdout = process.stdout.write
const originalStderr = process.stderr.write

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalStdout
  process.stderr.write = originalStderr
})

function capture(stream: "stdout" | "stderr"): () => string {
  let buf = ""
  process[stream].write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString()
    return true
  }) as typeof process.stdout.write
  return () => buf
}

function mockResponse(status: number, body: string, urls: string[] = []) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input))
    return new Response(body, { status })
  }) as unknown as typeof fetch
  return urls
}

const job = (code: string, extra: Record<string, unknown> = {}) => ({
  title: `Role ${code}`,
  company: "Acme",
  locations: ["Gdańsk"],
  isRemote: false,
  isHybrid: false,
  url: `https://solid.jobs/o/${code}/ai-job-search-cli`,
  salary: { from: 20000, to: 26000, currency: "PLN", period: "Month", employmentType: "B2B" },
  validFrom: "2026-10-20T10:00:00+02:00",
  ...extra,
})

const apiBody = (jobs: unknown[]) =>
  JSON.stringify({ pageIndex: 0, pageSize: 50, totalCount: jobs.length, totalPages: 1, jobs })

const base: SearchOpts = { division: "IT", page: 1, format: "json" }

describe("search output", () => {
  test("json carries the meta block and every contract field", async () => {
    mockResponse(200, apiBody([job("aaa111bb"), job("ccc222dd")]))
    const out = capture("stdout")
    expect(await runSearch(base)).toBe(0)
    const parsed = JSON.parse(out())
    expect(parsed.meta).toEqual({ count: 2, page: 1, pages: 1, totalCount: 2, totalPages: 1, truncated: false })
    const r = parsed.results[0]
    for (const key of ["id", "title", "company", "location", "date", "url", "workplaceType", "experienceLevel", "category", "subCategory", "salary", "secondarySalary", "deadline", "skills", "languages"]) {
      expect(r).toHaveProperty(key)
    }
    expect(r.id).toBe("aaa111bb")
    expect(r.url).toBe("https://solid.jobs/o/aaa111bb")
    expect(r.date).toBe("2026-10-20")
  })

  test("table prints a header and one row per offer", async () => {
    mockResponse(200, apiBody([job("aaa111bb")]))
    const out = capture("stdout")
    expect(await runSearch({ ...base, format: "table" })).toBe(0)
    const lines = out().trimEnd().split("\n")
    expect(lines[0]).toContain("TITLE")
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain("Role aaa111bb")
  })

  test("table says so when nothing matches", async () => {
    mockResponse(200, apiBody([]))
    const out = capture("stdout")
    expect(await runSearch({ ...base, format: "table" })).toBe(0)
    expect(out().trim()).toBe("No results.")
  })

  test("plain prints title, id and url per offer", async () => {
    mockResponse(200, apiBody([job("aaa111bb")]))
    const out = capture("stdout")
    expect(await runSearch({ ...base, format: "plain" })).toBe(0)
    expect(out()).toContain("Role aaa111bb")
    expect(out()).toContain("id: aaa111bb")
    expect(out()).toContain("https://solid.jobs/o/aaa111bb")
  })

  test("--limit caps the emitted results", async () => {
    mockResponse(200, apiBody([job("aaa111bb"), job("ccc222dd"), job("eee333ff")]))
    const out = capture("stdout")
    expect(await runSearch({ ...base, limit: 2 })).toBe(0)
    expect(JSON.parse(out()).results).toHaveLength(2)
  })

  test("--remote filters client-side on the workplace type", async () => {
    mockResponse(200, apiBody([job("aaa111bb"), job("ccc222dd", { isRemote: true }), job("eee333ff", { isHybrid: true })]))
    const out = capture("stdout")
    expect(await runSearch({ ...base, remote: "remote" })).toBe(0)
    const ids = JSON.parse(out()).results.map((r: { id: string }) => r.id)
    expect(ids).toEqual(["ccc222dd"])
  })

  test("requests the division path with the campaign and search term", async () => {
    const urls = mockResponse(200, apiBody([]))
    capture("stdout")
    await runSearch({ ...base, division: "Engineering", query: "php" })
    const u = new URL(urls[0])
    expect(u.pathname).toBe("/public-api/offers/Engineering")
    expect(u.searchParams.get("campaign")).toBe("ai-job-search-cli")
    expect(u.searchParams.get("search.searchTerm")).toBe("php")
    expect(urls).toHaveLength(1)
  })

  test("only contacts solid.jobs", async () => {
    const urls = mockResponse(200, apiBody([job("aaa111bb")]))
    capture("stdout")
    await runSearch({ ...base, all: true, pageDelayMs: 0 })
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) expect(new URL(u).hostname).toBe("solid.jobs")
  })

  test("a 400 exits 1 with BAD_REQUEST and the API's explanation", async () => {
    mockResponse(400, "searchTerm too long")
    const err = capture("stderr")
    expect(await runSearch(base)).toBe(1)
    const e = JSON.parse(err())
    expect(e.code).toBe("BAD_REQUEST")
    expect(e.error).toContain("searchTerm too long")
  })

  test("a 404 division exits 1 with NOT_FOUND", async () => {
    mockResponse(404, "")
    const err = capture("stderr")
    expect(await runSearch(base)).toBe(1)
    expect(JSON.parse(err()).code).toBe("NOT_FOUND")
  })

  test("a non-JSON body exits 1 with SEARCH_FAILED", async () => {
    mockResponse(200, "<html>maintenance</html>")
    const err = capture("stderr")
    expect(await runSearch(base)).toBe(1)
    expect(JSON.parse(err()).code).toBe("SEARCH_FAILED")
  })
})

const detailPage = (posting: object) => `<html><head>
<script type="application/ld+json">${JSON.stringify(posting)}</script>
</head><body></body></html>`

const posting = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Backend Engineer",
  description: "<p>Zakres</p><ul><li>API</li></ul>",
  hiringOrganization: { name: "Example" },
  jobLocation: { address: { addressLocality: "Szczecin" } },
  validThrough: "2999-12-01T10:00:00+01:00",
  datePosted: "2026-10-20",
}

describe("invisible characters never reach the output", () => {
  const dirty = job("aaa111bb", { title: "Role\u202E\u200B visible\u001B[31m", company: "Ac\u0007me" })

  test("search json, table and plain are all sanitised", async () => {
    for (const format of ["json", "table", "plain"] as const) {
      mockResponse(200, apiBody([dirty]))
      const out = capture("stdout")
      expect(await runSearch({ ...base, format })).toBe(0)
      // eslint-disable-next-line no-control-regex
      expect(out()).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E]/)
      expect(out()).toContain("visible")
    }
  })

  test("detail json and plain are sanitised", async () => {
    const hostile = { ...posting, title: "Back\u202Eend\u001B[31m", description: "<p>ok\u200B text</p>" }
    for (const format of ["json", "plain"] as const) {
      mockResponse(200, detailPage(hostile))
      const out = capture("stdout")
      expect(await runDetail({ id: "abc123xy", format })).toBe(0)
      expect(out()).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E]/)
      expect(out()).toContain("Backend")
      expect(out()).toContain("ok text")
    }
  })
})

describe("detail output", () => {
  test("json returns the parsed offer fetched from the short link", async () => {
    const urls = mockResponse(200, detailPage(posting))
    const out = capture("stdout")
    expect(await runDetail({ id: "abc123xy", format: "json" })).toBe(0)
    expect(urls).toEqual(["https://solid.jobs/o/abc123xy"])
    const d = JSON.parse(out())
    expect(d.id).toBe("abc123xy")
    expect(d.title).toBe("Backend Engineer")
    expect(d.company).toBe("Example")
    expect(d.description).not.toMatch(/<[a-z][^>]*>/i)
  })

  test("plain prints status, description and url", async () => {
    mockResponse(200, detailPage(posting))
    const out = capture("stdout")
    expect(await runDetail({ id: "abc123xy", format: "plain" })).toBe(0)
    expect(out()).toContain("Backend Engineer")
    expect(out()).toContain("Status: ACTIVE")
    expect(out()).toContain("URL: https://solid.jobs/o/abc123xy")
  })

  test("a full offer URL is fetched from its own path", async () => {
    const urls = mockResponse(200, detailPage(posting))
    capture("stdout")
    await runDetail({ id: "https://solid.jobs/offer/123456/backend-engineer", format: "json" })
    expect(urls).toEqual(["https://solid.jobs/offer/123456/backend-engineer"])
  })

  test("a 404 exits 1 with NOT_FOUND", async () => {
    mockResponse(404, "")
    const err = capture("stderr")
    expect(await runDetail({ id: "abc123xy", format: "json" })).toBe(1)
    expect(JSON.parse(err()).code).toBe("NOT_FOUND")
  })

  test("a page without JobPosting exits 1 with NOT_FOUND", async () => {
    mockResponse(200, "<html><body>gone</body></html>")
    const err = capture("stderr")
    expect(await runDetail({ id: "abc123xy", format: "json" })).toBe(1)
    expect(JSON.parse(err()).code).toBe("NOT_FOUND")
  })

  test("an id on another host exits 1 with BAD_ID and makes no request", async () => {
    const urls = mockResponse(200, "")
    const err = capture("stderr")
    expect(await runDetail({ id: "https://solid.jobs.evil.io/o/abc123xy", format: "json" })).toBe(1)
    expect(JSON.parse(err()).code).toBe("BAD_ID")
    expect(urls).toHaveLength(0)
  })
})
