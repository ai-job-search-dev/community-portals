import { afterEach, describe, expect, test } from "bun:test";
import { htmlFetch } from "../src/helpers";

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts, and a stubbed setTimeout
// records each delay and fires immediately, so the schedule is asserted
// without sleeping through the real 500ms -> 8s backoff.

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

// Exponential from 500ms, doubling, capped at 8s, plus up to 500ms of jitter.
function expectBackoff(delays: number[], retries: number) {
  expect(delays).toHaveLength(retries);
  delays.forEach((ms, k) => {
    const base = Math.min(500 * 2 ** k, 8000);
    expect(ms).toBeGreaterThanOrEqual(base);
    expect(ms).toBeLessThan(base + 500);
  });
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

describe("htmlFetch retry/backoff", () => {
  test("retries a 429 after a backoff delay and succeeds on the next attempt", async () => {
    const delays = instantTimers();
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response("ok", { status: 200 }),
    ]);

    const body = await htmlFetch("https://gracklehq.com/jobs");
    expect(body).toContain("ok");
    expect(state.calls).toBe(2);
    expectBackoff(delays, 1);
  });

  test("returns the documented empty string on 404 without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 404 })]);

    const body = await htmlFetch("https://gracklehq.com/jobs");
    expect(body).toBe("");
    expect(state.calls).toBe(1);
  });

  test("gives up after the initial attempt plus six retries on persistent 5xx, backing off 500ms -> 8s", async () => {
    const delays = instantTimers();
    const state = stubFetch([() => new Response("", { status: 500 })]);

    await expect(htmlFetch("https://gracklehq.com/jobs")).rejects.toThrow(/500/);
    expect(state.calls).toBe(7);
    expectBackoff(delays, 6);
  });
});
