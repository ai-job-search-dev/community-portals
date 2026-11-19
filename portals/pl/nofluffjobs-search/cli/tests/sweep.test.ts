import { afterEach, describe, expect, test } from "bun:test"
import { runSearch, type SearchOpts } from "../src/commands/search.js"

// Offline: a mocked search page whose embedded state carries the dates.

const originalFetch = globalThis.fetch
const originalStdout = process.stdout.write

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalStdout
})

function captureStdout(): () => string {
  let buf = ""
  process.stdout.write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString()
    return true
  }) as typeof process.stdout.write
  return () => buf
}

const card = (slug: string, title: string) =>
  `<a nfj-postings-item="" class="posting-list-item" href="/pl/job/${slug}">
    <h3 data-cy="title position on the job offer listing"> ${title} </h3>
  </a>`

function page(cards: { slug: string; posted: string }[], totalCount: number): string {
  const state = {
    abc: {
      totalCount,
      postings: cards.map((c) => ({ url: c.slug, title: c.slug, posted: Date.parse(c.posted) })),
    },
  }
  return `<html><nfj-postings-list listname="search">${cards.map((c) => card(c.slug, c.slug)).join("")}</nfj-postings-list>
    <script id="serverApp-state" type="application/json">${JSON.stringify(state)}</script></html>`
}

function mock(html: string): URL[] {
  const requests: URL[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(new URL(String(input)))
    return new Response(html)
  }) as typeof fetch
  return requests
}

const base: SearchOpts = { query: "php", page: 1, dates: false, format: "json" }
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString()

describe("dates from the page state", () => {
  test("--jobage filters on state dates without one detail request per result", async () => {
    const requests = mock(page([{ slug: "fresh", posted: iso(0) }, { slug: "stale", posted: iso(30) }], 2))
    const out = captureStdout()
    expect(await runSearch({ ...base, jobage: 14 })).toBe(0)
    expect(requests).toHaveLength(1)
    const body = JSON.parse(out())
    expect(body.results.map((r: { id: string }) => r.id)).toEqual(["fresh"])
    expect(body.results[0].date).toBe(iso(0).slice(0, 10))
  })
})

describe("--all", () => {
  test("fetches the 10-page cumulative view in a single request", async () => {
    const requests = mock(page([{ slug: "a", posted: iso(0) }], 1))
    const out = captureStdout()
    await runSearch({ ...base, all: true })
    expect(requests).toHaveLength(1)
    expect(requests[0].searchParams.get("page")).toBe("10")
    expect(JSON.parse(out()).meta).toMatchObject({ count: 1, total: 1, truncated: false })
  })

  test("reports truncated when the portal holds more matches than the view returned", async () => {
    mock(page([{ slug: "a", posted: iso(0) }, { slug: "b", posted: iso(0) }], 350))
    const out = captureStdout()
    await runSearch({ ...base, all: true })
    expect(JSON.parse(out()).meta).toMatchObject({ count: 2, total: 350, truncated: true })
  })
})
