import { afterEach, describe, expect, test } from "bun:test";
import { htmlFetch, jsonFetch } from "../src/helpers";

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts, and a stubbed setTimeout
// records each requested delay and then fires immediately, so the exhaustion
// case checks the real 500ms -> 8s backoff schedule without sleeping through it.

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

function instantTimers(): number[] {
  const delays: number[] = [];
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    return originalSetTimeout(fn, 0);
  }) as unknown as typeof setTimeout;
  return delays;
}

function stubFetch(responses: Array<() => Response>): { calls: number; userAgents: string[] } {
  const state = { calls: 0, userAgents: [] as string[] };
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    state.userAgents.push(new Headers(init?.headers).get("User-Agent") ?? "");
    const i = Math.min(state.calls, responses.length - 1);
    state.calls++;
    return responses[i]();
  }) as unknown as typeof fetch;
  return state;
}

describe("jsonFetch / htmlFetch retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers();
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => Response.json({ data: [], pagination: { total: 0, limit: 10, offset: 0 } }),
    ]);

    const data = await jsonFetch<{ data: unknown[] }>("https://portal.gupy.io/api/job-search/jobs");
    expect(data?.data).toEqual([]);
    expect(state.calls).toBe(2);
  });

  test("returns null on 404 without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 404 })]);

    expect(await htmlFetch("https://example.gupy.io/job/x")).toBeNull();
    expect(state.calls).toBe(1);
  });

  test("gives up after the initial attempt plus six retries on persistent 5xx, backing off exponentially", async () => {
    const delays = instantTimers();
    const state = stubFetch([() => new Response("", { status: 503 })]);

    await expect(jsonFetch("https://portal.gupy.io/api/job-search/jobs")).rejects.toThrow(/503/);
    expect(state.calls).toBe(7);
    // 500ms doubling to an 8s cap, each plus up to 500ms of jitter.
    const base = [500, 1000, 2000, 4000, 8000, 8000];
    expect(delays).toHaveLength(base.length);
    delays.forEach((ms, i) => {
      expect(ms).toBeGreaterThanOrEqual(base[i]);
      expect(ms).toBeLessThan(base[i] + 500);
    });
  });

  test("follows a redirect only to a URL the caller allows", async () => {
    const redirect = (to: string) => () => new Response("", { status: 302, headers: { Location: to } });

    const ok = stubFetch([redirect("https://other.gupy.io/job/y"), () => new Response("<html>ok</html>")]);
    const allowGupy = (u: URL) => u.hostname.endsWith(".gupy.io");
    expect(await htmlFetch("https://example.gupy.io/job/x", allowGupy)).toBe("<html>ok</html>");
    expect(ok.calls).toBe(2);

    const bad = stubFetch([redirect("https://evil.example/steal"), () => new Response("<html>evil</html>")]);
    await expect(htmlFetch("https://example.gupy.io/job/x", allowGupy)).rejects.toThrow(/redirect/);
    expect(bad.calls).toBe(1);
  });

  test("keeps the search API's redirects on its own origin", async () => {
    const state = stubFetch([() => new Response("", { status: 301, headers: { Location: "https://evil.example/" } })]);
    await expect(jsonFetch("https://portal.gupy.io/api/job-search/jobs")).rejects.toThrow(/redirect/);
    expect(state.calls).toBe(1);
  });

  test("identifies itself with the tool's own User-Agent", async () => {
    const state = stubFetch([() => new Response("<html></html>")]);

    await htmlFetch("https://example.gupy.io/job/x");
    expect(state.userAgents[0]).toBe("Mozilla/5.0 (compatible; gupy-cli/1.0)");
  });
});
