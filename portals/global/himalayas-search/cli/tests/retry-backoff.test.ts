import { afterEach, describe, expect, test } from "bun:test";
import { apiGet } from "../src/helpers";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

let delays: number[] = [];

function instantTimers() {
  delays = [];
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    return originalSetTimeout(fn, 0);
  }) as unknown as typeof setTimeout;
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

describe("Himalayas apiGet retry and error handling", () => {
  test("retries on 429 and succeeds on subsequent try", async () => {
    instantTimers();
    const state = stubFetch([
      () => new Response("rate limited", { status: 429 }),
      () => new Response(JSON.stringify({ jobs: [], limit: 20 }), { status: 200 }),
    ]);

    const res = await apiGet({ limit: 10, offset: 0 });
    expect(state.calls).toBe(2);
    expect(res.jobs).toEqual([]);
  });

  test("throws after exhausting retries on persistent 500", async () => {
    instantTimers();
    const state = stubFetch([() => new Response("server error", { status: 500 })]);

    await expect(apiGet({ limit: 10, offset: 0 })).rejects.toThrow(/request failed/i);
    expect(state.calls).toBe(7);
  });

  test("backs off exponentially and caps the delay at 8000 ms", async () => {
    instantTimers();
    stubFetch([() => new Response("server error", { status: 500 })]);

    await expect(apiGet({ limit: 10, offset: 0 })).rejects.toThrow(/request failed/i);

    // 500 -> 1000 -> 2000 -> 4000 -> 8000 -> 8000, plus up to 499 ms of jitter.
    const bases = [500, 1000, 2000, 4000, 8000, 8000];
    expect(delays.length).toBe(bases.length);
    delays.forEach((d, i) => {
      expect(d).toBeGreaterThanOrEqual(bases[i]);
      expect(d).toBeLessThan(bases[i] + 500);
    });
  });

  test("fails fast on network connection error without infinite retrying", async () => {
    const state = { calls: 0 };
    globalThis.fetch = (async () => {
      state.calls++;
      throw new Error("Connection refused");
    }) as unknown as typeof fetch;

    await expect(apiGet({ limit: 10, offset: 0 })).rejects.toThrow(/could not reach the Himalayas API/i);
    expect(state.calls).toBe(1);
  });
});
