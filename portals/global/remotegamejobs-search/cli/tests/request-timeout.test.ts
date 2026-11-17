import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { textFetch } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever - fetch has no default timeout. Assert the request
// wrapper carries a 15s AbortSignal.timeout, not just any signal.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("textFetch request timeout", () => {
  test("passes an AbortSignal timeout to fetch", async () => {
    const timeout = spyOn(AbortSignal, "timeout");
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await textFetch("https://remotegamejobs.com/x");
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(15000);
    expect(init?.signal).toBe(timeout.mock.results[0].value);
  });
});
