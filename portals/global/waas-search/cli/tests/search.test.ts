import { afterEach, describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"
import {
  unescapeHtml,
  htmlToPlain,
  parseDataPage,
  mapRawToCard,
  stripInvisible,
  validateApplyUrl,
  parseJobDetail,
  fetchJobs,
  htmlFetch,
  jsonFetch,
  type WaasJobDetail,
} from "../src/helpers.js"
import { normalizeId, renderDetailPlain, runDetail } from "../src/commands/detail.js"
import { runSearch } from "../src/commands/search.js"

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
const originalStdoutWrite = process.stdout.write
const originalStderrWrite = process.stderr.write

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
  process.stdout.write = originalStdoutWrite
  process.stderr.write = originalStderrWrite
})

function instantTimers() {
  globalThis.setTimeout = ((fn: () => void) =>
    originalSetTimeout(fn, 0)) as unknown as typeof setTimeout
}

function captureOutput() {
  let stdout = ""
  let stderr = ""
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString()
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString()
    return true
  }) as typeof process.stderr.write
  return {
    getStdout: () => stdout,
    getStderr: () => stderr,
  }
}

describe("waas-cli flag validation", () => {
  test("unknown flag exits 1 with UNKNOWN_FLAG on stderr", async () => {
    const res = await runCLI(["search", "--bogus-flag"])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("UNKNOWN_FLAG")
    expect(err.error).toContain("--bogus-flag")
  })

  test("invalid --limit exits 1 with BAD_ARG on stderr", async () => {
    const res = await runCLI(["search", "--limit", "abc"])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("BAD_ARG")
  })

  test("negative --limit exits 1 with BAD_ARG on stderr", async () => {
    const res = await runCLI(["search", "--limit", "-5"])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("BAD_ARG")
  })

  test("unexpected positional argument on search exits 1 with BAD_ARG on stderr", async () => {
    const res = await runCLI(["search", "extra-arg"])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("unexpected argument")
  })

  test("unexpected positional argument on detail exits 1 with BAD_ARG on stderr", async () => {
    const res = await runCLI(["detail", "12345", "extra-arg"])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("unexpected argument")
  })

  test("invalid --format on search exits 1 with BAD_ARG on stderr", async () => {
    const res = await runCLI(["search", "--format", "bogus"])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("--format must be one of json|table|plain")
  })

  test("bare --format on search exits 1 with BAD_ARG on stderr", async () => {
    const res = await runCLI(["search", "--format"])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("--format must be one of json|table|plain")
  })

  test("invalid --format (table) on detail exits 1 with BAD_ARG on stderr", async () => {
    const res = await runCLI(["detail", "12345", "--format", "table"])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("--format must be one of json|plain")
  })

  test("bare --format on detail exits 1 with BAD_ARG on stderr", async () => {
    const res = await runCLI(["detail", "12345", "--format"])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("--format must be one of json|plain")
  })

  test("bare --query on search exits 1 with BAD_ARG on stderr", async () => {
    const res = await runCLI(["search", "-q"])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("--query requires a non-empty value")
  })

  test("empty --query on search exits 1 with BAD_ARG on stderr", async () => {
    const res = await runCLI(["search", "--query", "   "])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("--query requires a non-empty value")
  })

  test("detail without ID exits 1 with NO_ID on stderr", async () => {
    const res = await runCLI(["detail"])
    expect(res.exitCode).toBe(1)
    const err = JSON.parse(res.stderr)
    expect(err.code).toBe("NO_ID")
  })

  test("--help exits 0 and prints usage", async () => {
    const res = await runCLI(["--help"])
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain("waas-cli")
    expect(res.stdout).toContain("SEARCH FLAGS")
  })
})

describe("waas-cli helpers", () => {
  test("normalizeId extracts numeric ID from raw string or valid URL", () => {
    expect(normalizeId("67196")).toBe("67196")
    expect(normalizeId("https://www.workatastartup.com/jobs/67196")).toBe("67196")
    expect(normalizeId("https://www.workatastartup.com/jobs/13302?query=test")).toBe("13302")
    expect(normalizeId("http://workatastartup.com/jobs/67196/")).toBe("67196")
    expect(normalizeId("invalid-id")).toBe(null)
  })

  test("normalizeId rejects URLs from unrelated domains or wrong paths", () => {
    expect(normalizeId("https://evil.com/jobs/67196")).toBe(null)
    expect(normalizeId("https://otheryc.com/jobs/67196")).toBe(null)
    expect(normalizeId("https://www.workatastartup.com/companies/foo/jobs/67196")).toBe(null)
    expect(normalizeId("https://www.workatastartup.com/jobs/notanumber")).toBe(null)
  })

  test("unescapeHtml unescapes standard entities in a single pass", () => {
    const escaped = "&quot;Hello &amp; World&#39;&quot; &lt;div&gt;"
    expect(unescapeHtml(escaped)).toBe('"Hello & World\'" <div>')
  })

  test("unescapeHtml does not double-decode nested entities", () => {
    expect(unescapeHtml("&amp;lt;")).toBe("&lt;")
    expect(unescapeHtml("&amp;#34;")).toBe("&#34;")
    expect(unescapeHtml("&amp;quot;")).toBe("&quot;")
    expect(unescapeHtml("&amp;amp;")).toBe("&amp;")
  })

  test("unescapeHtml handles numeric entities above U+FFFF with String.fromCodePoint", () => {
    expect(unescapeHtml("&#128512;")).toBe("😀")
    expect(unescapeHtml("&#x1F600;")).toBe("😀")
  })

  test("htmlToPlain strips tags and preserves paragraphs", () => {
    const html = "<p>First paragraph.</p><p>Second paragraph with <b>bold</b> text.</p><ul><li>Item 1</li><li>Item 2</li></ul>"
    const plain = htmlToPlain(html)
    expect(plain).toContain("First paragraph.")
    expect(plain).toContain("Second paragraph with bold text.")
    expect(plain).toContain("• Item 1")
    expect(plain).toContain("• Item 2")
  })

  test("htmlToPlain sanitizes script, style, comments, and hidden elements", () => {
    const html = `
      <p>Visible intro.</p>
      <script>alert("evil")</script>
      <style>body { display: none; }</style>
      <template><p>Template content</p></template>
      <!-- HTML comment -->
      <div hidden>Hidden text</div>
      <span style="display:none">Inline hidden text</span>
      <p>Visible footer.</p>
    `
    const plain = htmlToPlain(html)
    expect(plain).toContain("Visible intro.")
    expect(plain).toContain("Visible footer.")
    expect(plain).not.toContain("alert")
    expect(plain).not.toContain("Template content")
    expect(plain).not.toContain("HTML comment")
    expect(plain).not.toContain("Hidden text")
    expect(plain).not.toContain("Inline hidden text")
  })

  test("stripInvisible strips invisible control characters", () => {
    const dirty = "Hello\u0000\u200B\uFEFF World\u00AD!"
    expect(stripInvisible(dirty)).toBe("Hello World!")
  })

  test("parseDataPage extracts Inertia payload", () => {
    const html = '<div data-page="{&quot;component&quot;:&quot;JobsPage&quot;,&quot;props&quot;:{&quot;jobs&quot;:[{&quot;id&quot;:123,&quot;title&quot;:&quot;Engineer&quot;}]}}"></div>'
    const data = parseDataPage(html)
    expect(data).not.toBe(null)
    expect(data.component).toBe("JobsPage")
    expect(data.props.jobs[0].id).toBe(123)
  })

  test("parseDataPage does not break on descriptions with literal entity-encoded quotes", () => {
    // When text contains &amp;#34; it should remain &#34; rather than turn into a raw unescaped quote that breaks JSON.parse
    const html = '<div data-page="{&quot;component&quot;:&quot;JobsPage&quot;,&quot;props&quot;:{&quot;job&quot;:{&quot;description&quot;:&quot;Contains &amp;#34; literal quote entity&quot;}}}"></div>'
    const data = parseDataPage(html)
    expect(data).not.toBe(null)
    expect(data.props.job.description).toBe('Contains &#34; literal quote entity')
  })

  test("mapRawToCard maps fields and computes remote flag", () => {
    const card = mapRawToCard({
      id: 456,
      title: "Fullstack Dev",
      companyName: "Acme",
      companyBatch: "W24",
      location: "San Francisco, CA / Remote",
      roleType: "Full stack",
      salary: "$150K",
    })
    expect(card.id).toBe("456")
    expect(card.title).toBe("Fullstack Dev")
    expect(card.company).toBe("Acme")
    expect(card.batch).toBe("W24")
    expect(card.remote).toBe(true)
    expect(card.category).toBe("Full stack")
    expect(card.salary).toBe("$150K")
    expect(card.url).toBe("https://www.workatastartup.com/jobs/456")
  })

  test("validateApplyUrl accepts http/https and rejects invalid or missing URLs", () => {
    expect(validateApplyUrl("https://account.ycombinator.com/apply")).toBe("https://account.ycombinator.com/apply")
    expect(validateApplyUrl("http://example.com/apply")).toBe("http://example.com/apply")
    expect(validateApplyUrl("/jobs/123/apply")).toBe("https://www.workatastartup.com/jobs/123/apply")
    expect(validateApplyUrl("javascript:alert(1)")).toBe(null)
    expect(validateApplyUrl("")).toBe(null)
    expect(validateApplyUrl(null)).toBe(null)
    expect(validateApplyUrl(undefined)).toBe(null)
  })

  test("parseJobDetail preserves null applyUrl when missing or invalid", () => {
    const payload = {
      props: {
        job: { title: "Software Engineer", salaryRange: "$100k" },
        company: { name: "TestCo" },
        applyUrl: "javascript:void(0)",
      },
    }
    const detail = parseJobDetail(payload, "999")
    expect(detail.applyUrl).toBe(null)
    expect(detail.url).toBe("https://www.workatastartup.com/jobs/999")
  })

  test("renderDetailPlain preserves section break spacers and handles unavailable apply URL", () => {
    const detail: WaasJobDetail = {
      id: "123",
      title: "Engineer",
      company: "Acme",
      batch: "W24",
      location: "Remote",
      remote: true,
      category: null,
      salary: "$120k",
      equity: null,
      jobType: "Fulltime",
      minExperience: null,
      sponsorsVisa: null,
      skills: ["TypeScript", "Bun"],
      date: null,
      url: "https://www.workatastartup.com/jobs/123",
      description: "Build things.",
      companyDescription: "Acme builds things.",
      techDescription: null,
      hiringDescription: null,
      companyUrl: null,
      teamSize: null,
      applyUrl: null,
    }

    const plain = renderDetailPlain(detail)
    expect(plain).toContain("Engineer\nAcme (W24) · Remote\n\nSalary: $120k\nEmployment: Fulltime\nSkills: TypeScript, Bun\n\n--- JOB DESCRIPTION ---")
    expect(plain).toContain("\n\n--- ABOUT COMPANY ---\nAcme builds things.")
    expect(plain).toContain("Apply URL: unavailable")
  })
})

describe("waas-cli backoff contract", () => {
  function recordTimers(): number[] {
    const delays: number[] = []
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0)
      return originalSetTimeout(fn, 0)
    }) as unknown as typeof setTimeout
    return delays
  }

  test("jsonFetch retries a 429 and succeeds on the next attempt", async () => {
    recordTimers()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      if (calls === 1) return new Response("rate limited", { status: 429, statusText: "Too Many Requests" })
      return new Response(JSON.stringify({ jobs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    const data = await jsonFetch<{ jobs: unknown[] }>("https://www.workatastartup.com/jobs/search?q=x")
    expect(calls).toBe(2)
    expect(data?.jobs).toEqual([])
  })

  test("a persistent 503 exhausts seven attempts with a doubling delay capped at 8000 ms", async () => {
    const delays = recordTimers()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response("unavailable", { status: 503, statusText: "Service Unavailable" })
    }) as unknown as typeof fetch

    await expect(jsonFetch("https://www.workatastartup.com/jobs/search?q=x")).rejects.toThrow(/Request failed: 503/)

    expect(calls).toBe(7)
    const bases = [500, 1000, 2000, 4000, 8000, 8000]
    expect(delays.length).toBe(bases.length)
    delays.forEach((d, i) => {
      expect(d).toBeGreaterThanOrEqual(bases[i])
      expect(d).toBeLessThan(bases[i] + 500)
    })
  })

  test("htmlFetch retries a 429 the same way", async () => {
    recordTimers()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      if (calls === 1) return new Response("rate limited", { status: 429, statusText: "Too Many Requests" })
      return new Response("<html><body>ok</body></html>", { status: 200 })
    }) as unknown as typeof fetch

    const html = await htmlFetch("https://www.workatastartup.com/jobs")
    expect(calls).toBe(2)
    expect(html).toContain("ok")
  })

  test("mapRawToCard strips invisible characters from search results", () => {
    const card = mapRawToCard({
      id: 42,
      title: "Frontend\u200b Engineer",
      companyName: "Acme\u202Eevil",
      location: "Remote",
    } as never)
    expect(card.title).toBe("Frontend Engineer")
    expect(card.company).toBe("Acmeevil")
  })
})

describe("waas-cli network-free search and detail (mocked)", () => {
  const sampleInertiaHtml = `<div data-page="{&quot;component&quot;:&quot;JobsPage&quot;,&quot;props&quot;:{&quot;jobs&quot;:[{&quot;id&quot;:67196,&quot;title&quot;:&quot;Frontend Engineer&quot;,&quot;companyName&quot;:&quot;Chima&quot;,&quot;companyBatch&quot;:&quot;W23&quot;,&quot;location&quot;:&quot;Remote (US)&quot;,&quot;roleType&quot;:&quot;Frontend&quot;,&quot;salary&quot;:&quot;$80K - $250K&quot;,&quot;companyLastActiveAt&quot;:&quot;3 days ago&quot;}]}}"></div>`

  const sampleSearchJson = {
    jobs: [
      {
        id: 67196,
        title: "Frontend Engineer",
        companyName: "Chima",
        companyBatch: "W23",
        location: "Remote (US)",
        roleType: "Frontend",
        salary: "$80K - $250K",
        companyLastActiveAt: "3 days ago",
      },
    ],
  }

  test("mocked search returns results matching schema deterministically without live network", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/jobs/search")) {
        return new Response(JSON.stringify(sampleSearchJson), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(sampleInertiaHtml, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    }) as unknown as typeof fetch

    const { getStdout } = captureOutput()
    const code = await runSearch({
      query: "frontend engineer",
      remote: true,
      limit: 3,
      format: "json",
    })

    expect(code).toBe(0)
    const data = JSON.parse(getStdout())
    expect(data.meta.count).toBe(1)
    expect(data.results.length).toBe(1)

    const first = data.results[0]
    expect(first.id).toBe("67196")
    expect(first.title).toBe("Frontend Engineer")
    expect(first.company).toBe("Chima")
    expect(first.remote).toBe(true)
    expect(first.url).toBe("https://www.workatastartup.com/jobs/67196")
  })

  test("fetchJobs throws when every fetch fails (429/5xx) and emits SEARCH_FAILED on stderr with exit 1", async () => {
    instantTimers()
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts++
      return new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" })
    }) as unknown as typeof fetch

    const { getStdout, getStderr } = captureOutput()
    const code = await runSearch({
      query: "anything",
      format: "table",
    })

    expect(code).toBe(1)
    expect(getStdout()).toBe("")
    const err = JSON.parse(getStderr().trim())
    expect(err.code).toBe("SEARCH_FAILED")
    expect(err.error).toContain("Request failed: 500")
    // 1 initial attempt + 6 retries, for each of the two fetch paths
    expect(attempts).toBe(14)
  })

  test("fetchJobs does not throw when HTML fetch fails but search API succeeds", async () => {
    instantTimers()
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/jobs/search")) {
        return new Response(JSON.stringify(sampleSearchJson), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      // HTML page fails with 500
      return new Response("Error", { status: 500, statusText: "Internal Server Error" })
    }) as unknown as typeof fetch

    const { getStdout } = captureOutput()
    const code = await runSearch({
      query: "frontend engineer",
      format: "json",
    })

    expect(code).toBe(0)
    const data = JSON.parse(getStdout())
    expect(data.meta.count).toBe(1)
    expect(data.results[0].id).toBe("67196")
  })

  test("fetchJobs returns empty array with exit 0 when search genuinely has no matches", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/jobs/search")) {
        return new Response(JSON.stringify({ jobs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(
        '<div data-page="{&quot;component&quot;:&quot;JobsPage&quot;,&quot;props&quot;:{&quot;jobs&quot;:[]}}"></div>',
        { status: 200, headers: { "Content-Type": "text/html" } },
      )
    }) as unknown as typeof fetch

    const { getStdout } = captureOutput()
    const code = await runSearch({
      query: "nonexistent-job-title",
      format: "table",
    })

    expect(code).toBe(0)
    expect(getStdout()).toContain("No results.")
  })

  test("runDetail reports NOT_FOUND when page returns 404", async () => {
    globalThis.fetch = (async () => {
      return new Response("Not Found", { status: 404, statusText: "Not Found" })
    }) as unknown as typeof fetch

    const { getStderr } = captureOutput()
    const code = await runDetail({ id: "99999", format: "json" })
    expect(code).toBe(1)
    const err = JSON.parse(getStderr().trim())
    expect(err.code).toBe("NOT_FOUND")
  })

  test("runDetail reports PARSE_FAILED when page returns 200 but payload lacks job", async () => {
    globalThis.fetch = (async () => {
      return new Response("<html><body><div>Page with no data-page</div></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    }) as unknown as typeof fetch

    const { getStderr } = captureOutput()
    const code = await runDetail({ id: "67196", format: "json" })
    expect(code).toBe(1)
    const err = JSON.parse(getStderr().trim())
    expect(err.code).toBe("PARSE_FAILED")
  })

  test("runDetail returns full detail on valid page payload", async () => {
    const detailHtml = `<div data-page="{&quot;component&quot;:&quot;JobDetailPage&quot;,&quot;props&quot;:{&quot;job&quot;:{&quot;id&quot;:67196,&quot;title&quot;:&quot;Frontend Engineer&quot;,&quot;salaryRange&quot;:&quot;$120k - $160k&quot;,&quot;descriptionHtml&quot;:&quot;<p>Build great UI.</p>&quot;},&quot;company&quot;:{&quot;name&quot;:&quot;Acme Corp&quot;,&quot;batch&quot;:&quot;W24&quot;},&quot;applyUrl&quot;:&quot;https://account.ycombinator.com/apply&quot;}}"></div>`

    globalThis.fetch = (async () => {
      return new Response(detailHtml, { status: 200, headers: { "Content-Type": "text/html" } })
    }) as unknown as typeof fetch

    const { getStdout } = captureOutput()
    const code = await runDetail({ id: "67196", format: "json" })
    expect(code).toBe(0)
    const data = JSON.parse(getStdout()) as WaasJobDetail
    expect(data.id).toBe("67196")
    expect(data.title).toBe("Frontend Engineer")
    expect(data.company).toBe("Acme Corp")
    expect(data.applyUrl).toBe("https://account.ycombinator.com/apply")
    expect(data.description).toContain("Build great UI.")
  })
})
