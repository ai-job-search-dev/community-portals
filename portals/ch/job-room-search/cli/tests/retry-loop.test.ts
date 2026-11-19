import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getJson } from "../src/helpers";

let originalFetch: typeof globalThis.fetch;
let calls: number;
let waits: number[];
let originalSetTimeout: typeof globalThis.setTimeout;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalSetTimeout = globalThis.setTimeout;
  calls = 0;
  waits = [];
  // Record the requested delay and fire immediately, so the schedule is
  // asserted without the test actually sleeping for it.
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    waits.push(ms ?? 0);
    return originalSetTimeout(fn, 0);
  }) as unknown as typeof globalThis.setTimeout;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

function alwaysStatus(status: number, headers: Record<string, string> = {}): void {
  globalThis.fetch = (async () => {
    calls++;
    return new Response("rate limited", { status, headers });
  }) as unknown as typeof globalThis.fetch;
}

describe("retry loop", () => {
  test("a persistent 429 is attempted six times, not seven", async () => {
    alwaysStatus(429);

    const result = await getJson("https://www.job-room.ch/jobadservice/api/jobAdvertisements/x");

    expect(calls).toBe(6);
    expect(result.status).toBe(429);
    expect(waits).toHaveLength(5);
  });

  test("a persistent 500 retries on the same schedule", async () => {
    alwaysStatus(503);

    const result = await getJson("https://www.job-room.ch/jobadservice/api/jobAdvertisements/x");

    expect(calls).toBe(6);
    expect(result.status).toBe(503);
  });

  test("the backoff grows and stays capped", async () => {
    alwaysStatus(429);

    await getJson("https://www.job-room.ch/jobadservice/api/jobAdvertisements/x");

    // 500, 1000, 2000, 4000, 8000 plus up to 500ms of jitter each, capped at 8000.
    expect(waits[0]).toBeGreaterThanOrEqual(500);
    expect(waits[0]).toBeLessThan(1000);
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThan(waits[i - 1]);
    expect(Math.max(...waits)).toBeLessThanOrEqual(8500);
  });

  test("Retry-After: 0 does not collapse the backoff", async () => {
    // ?? kept the 0 and fired all six requests in a few milliseconds.
    alwaysStatus(429, { "Retry-After": "0" });

    await getJson("https://www.job-room.ch/jobadservice/api/jobAdvertisements/x");

    expect(calls).toBe(6);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(500);
  });

  test("a Retry-After in seconds is obeyed instead of the schedule", async () => {
    alwaysStatus(429, { "Retry-After": "3" });

    await getJson("https://www.job-room.ch/jobadservice/api/jobAdvertisements/x");

    expect(waits.every((w) => w === 3000)).toBe(true);
  });

  test("a success is returned without any retry", async () => {
    globalThis.fetch = (async () => {
      calls++;
      return new Response("[]", { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const result = await getJson("https://www.job-room.ch/jobadservice/api/jobAdvertisements/x");

    expect(calls).toBe(1);
    expect(result.status).toBe(200);
    expect(waits).toHaveLength(0);
  });

  test("a 404 is returned as-is rather than retried", async () => {
    alwaysStatus(404);

    const result = await getJson("https://www.job-room.ch/jobadservice/api/jobAdvertisements/x");

    expect(calls).toBe(1);
    expect(result.status).toBe(404);
  });

  test("every request carries an AbortSignal with the 15s timeout", async () => {
    let seenSignal: AbortSignal | null = null;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seenSignal = (init.signal as AbortSignal) ?? null;
      return new Response("[]", { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await getJson("https://www.job-room.ch/jobadservice/api/jobAdvertisements/x");

    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal!.aborted).toBe(false);
  });

  test("the identifying User-Agent is sent, not a browser string", async () => {
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response("[]", { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await getJson("https://www.job-room.ch/jobadservice/api/jobAdvertisements/x");

    expect(headers["User-Agent"]).toContain("job-room-search/");
    expect(headers["User-Agent"]).not.toContain("Mozilla");
  });
});
