import { afterEach, describe, expect, test } from "bun:test";
import { textFetch } from "../src/helpers";

// The CLI reads only the board's feed, so a redirect may never take it to
// another host.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubRedirects(hops: Record<string, string | null>): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const to = hops[url];
    if (to === undefined) return new Response("<rss/>", { status: 200 });
    return new Response("", { status: 301, headers: to ? { Location: to } : {} });
  }) as unknown as typeof fetch;
  return seen;
}

describe("textFetch redirects", () => {
  test("follows a redirect on the board's own host", async () => {
    const seen = stubRedirects({ "https://www.workwithindies.com/careers/rss.xml": "/careers/feed.xml" });
    expect(await textFetch("https://www.workwithindies.com/careers/rss.xml")).toBe("<rss/>");
    expect(seen).toEqual(["https://www.workwithindies.com/careers/rss.xml", "https://www.workwithindies.com/careers/feed.xml"]);
  });

  test("refuses a redirect to another host without requesting it", async () => {
    const seen = stubRedirects({ "https://www.workwithindies.com/careers/rss.xml": "https://evil.example.com/feed" });
    await expect(textFetch("https://www.workwithindies.com/careers/rss.xml")).rejects.toThrow(/Refusing redirect/);
    expect(seen).toHaveLength(1);
  });
});
