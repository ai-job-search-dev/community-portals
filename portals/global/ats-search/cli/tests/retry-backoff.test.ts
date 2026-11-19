import { afterEach, describe, expect, test } from "bun:test";
import { fetchLeverJobs, fetchWithBackoff } from "../src/helpers";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

function instantTimers() {
  globalThis.setTimeout = ((fn: () => void) =>
    originalSetTimeout(fn, 0)) as unknown as typeof setTimeout;
}

function stubFetch(responses: Array<() => Response>): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    const i = Math.min(state.calls, responses.length - 1);
    state.calls++;
    return responses[i]();
  }) as unknown as typeof fetch;
  return state;
}

describe("ATS fetchWithBackoff retry and error handling", () => {
  test("retries on 429 and succeeds on subsequent try", async () => {
    instantTimers();
    const state = stubFetch([
      () => new Response("rate limited", { status: 429 }),
      () => new Response(JSON.stringify({ jobs: [] }), { status: 200 }),
    ]);

    const res = await fetchWithBackoff("https://example.com/api");
    expect(state.calls).toBe(2);
    expect(res).toEqual({ jobs: [] });
  });

  test("returns null on 404 without retrying", async () => {
    const state = stubFetch([() => new Response("Not found", { status: 404 })]);

    const res = await fetchWithBackoff("https://example.com/api");
    expect(res).toBeNull();
    expect(state.calls).toBe(1);
  });

  test("throws after exhausting retries on persistent 500", async () => {
    instantTimers();
    const state = stubFetch([() => new Response("server error", { status: 500 })]);

    await expect(fetchWithBackoff("https://example.com/api")).rejects.toThrow(/request failed/i);
    expect(state.calls).toBe(7);
  });

  test("fails fast on network connection error without infinite retrying", async () => {
    const state = { calls: 0 };
    globalThis.fetch = (async () => {
      state.calls++;
      throw new Error("Connection refused");
    }) as unknown as typeof fetch;

    await expect(fetchWithBackoff("https://example.com/api")).rejects.toThrow(/Connection error/i);
    expect(state.calls).toBe(1);
  });

  test("follows redirects to allowed ATS host", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(u);
      if (u === "https://boards-api.greenhouse.io/v1/boards/vercel/jobs") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://boards.greenhouse.io/v1/boards/vercel/jobs" },
        });
      }
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await fetchWithBackoff("https://boards-api.greenhouse.io/v1/boards/vercel/jobs");
    expect(urls).toEqual([
      "https://boards-api.greenhouse.io/v1/boards/vercel/jobs",
      "https://boards.greenhouse.io/v1/boards/vercel/jobs",
    ]);
    expect(res).toEqual({ jobs: [] });
  });

  test("rejects redirects to unauthorized host", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "https://malicious-site.com/exploit" },
      });
    }) as unknown as typeof fetch;

    await expect(
      fetchWithBackoff("https://boards-api.greenhouse.io/v1/boards/vercel/jobs")
    ).rejects.toThrow(/unauthorized host/i);
  });

  test("rejects an HTTPS to HTTP downgrade on an allowed host", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "http://boards-api.greenhouse.io/v1/boards/vercel/jobs" },
      });
    }) as unknown as typeof fetch;

    await expect(
      fetchWithBackoff("https://boards-api.greenhouse.io/v1/boards/vercel/jobs")
    ).rejects.toThrow(/unauthorized host/i);
  });

  test("fetchLeverJobs stops at the 5,000-posting cap when every page is full", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(u);
      const skip = Number(/skip=(\d+)/.exec(u)?.[1] ?? 0);
      const page = Array.from({ length: 100 }, (_, i) => ({
        id: `job-${skip + i}`,
        text: `Engineer ${skip + i}`,
        hostedUrl: `https://jobs.lever.co/meesho/job-${skip + i}`,
      }));
      return new Response(JSON.stringify(page), { status: 200 });
    }) as unknown as typeof fetch;

    const jobs = await fetchLeverJobs({ company: "Meesho", provider: "lever", slug: "meesho" });

    expect(requestedUrls).toHaveLength(50);
    expect(jobs).toHaveLength(5000);
  });

  test("fetchLeverJobs stops when the API returns an empty array", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const jobs = await fetchLeverJobs({ company: "Meesho", provider: "lever", slug: "meesho" });

    expect(calls).toBe(1);
    expect(jobs).toHaveLength(0);
  });

  test("fetchLeverJobs paginates using skip until page is shorter than limit", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(u);
      if (u.includes("skip=0")) {
        const page1 = Array.from({ length: 100 }, (_, i) => ({
          id: `job-${i}`,
          text: `Engineer ${i}`,
          hostedUrl: `https://jobs.lever.co/meesho/job-${i}`,
        }));
        return new Response(JSON.stringify(page1), { status: 200 });
      }
      if (u.includes("skip=100")) {
        const page2 = Array.from({ length: 25 }, (_, i) => ({
          id: `job-${100 + i}`,
          text: `Engineer ${100 + i}`,
          hostedUrl: `https://jobs.lever.co/meesho/job-${100 + i}`,
        }));
        return new Response(JSON.stringify(page2), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const jobs = await fetchLeverJobs({
      company: "Meesho",
      provider: "lever",
      slug: "meesho",
    });

    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]).toContain("skip=0&limit=100");
    expect(requestedUrls[1]).toContain("skip=100&limit=100");
    expect(jobs).toHaveLength(125);
  });
});
