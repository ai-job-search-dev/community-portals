import { afterEach, describe, expect, test } from "bun:test";
import { parseIdentifier } from "../src/commands/detail";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { cleanHtml, decodeHtmlEntities, loadWatchlist, sanitizeApplyUrl } from "../src/helpers";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ats-watchlist-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("ATS Watchlist parsing and identifiers", () => {
  test("parseIdentifier parses composite ID", () => {
    const gh = parseIdentifier("greenhouse:stripe:12345");
    expect(gh).toEqual({ provider: "greenhouse", slug: "stripe", jobId: "12345" });

    const lv = parseIdentifier("lever:meesho:abcd-1234");
    expect(lv).toEqual({ provider: "lever", slug: "meesho", jobId: "abcd-1234" });

    const as = parseIdentifier("ashby:notion:uuid-xyz");
    expect(as).toEqual({ provider: "ashby", slug: "notion", jobId: "uuid-xyz" });
  });

  test("parseIdentifier parses direct URLs", () => {
    const gh = parseIdentifier("https://boards.greenhouse.io/vercel/jobs/6136160004");
    expect(gh).toEqual({ provider: "greenhouse", slug: "vercel", jobId: "6136160004" });

    const lv = parseIdentifier(
      "https://jobs.lever.co/meesho/7d9af9b5-c1c7-48ec-bbb5-9b25e49f6596"
    );
    expect(lv).toEqual({
      provider: "lever",
      slug: "meesho",
      jobId: "7d9af9b5-c1c7-48ec-bbb5-9b25e49f6596",
    });

    const as = parseIdentifier(
      "https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a"
    );
    expect(as).toEqual({
      provider: "ashby",
      slug: "notion",
      jobId: "1fc309c8-da20-4ff2-84c7-8b863ece2b0a",
    });
  });

  test("decodeHtmlEntities decodes entities", () => {
    expect(decodeHtmlEntities("Lead &amp; Principal &#x2f; Staff")).toBe(
      "Lead & Principal / Staff"
    );
    // Escaped entities are decoded once without double-decoding &amp;lt; to <
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
  });

  test("cleanHtml formats markup into readable text", () => {
    const raw = "<h2>Requirements</h2><ul><li>5+ years React</li></ul>";
    const cleaned = cleanHtml(raw);
    expect(cleaned).toContain("Requirements");
    expect(cleaned).toContain("5+ years React");
  });

  test("cleanHtml preserves comparisons like <100ms and >99.9%", () => {
    const raw = "<p>Latency &lt;100ms and reliability &gt;99.9% guaranteed.</p>";
    const cleaned = cleanHtml(raw);
    expect(cleaned).toBe("Latency <100ms and reliability >99.9% guaranteed.");
  });

  test("sanitizeApplyUrl validates and resolves application URLs", () => {
    const postingUrl = "https://jobs.lever.co/meesho/123";
    expect(sanitizeApplyUrl("https://jobs.lever.co/meesho/123/apply", postingUrl)).toBe(
      "https://jobs.lever.co/meesho/123/apply"
    );
    expect(sanitizeApplyUrl("/apply", postingUrl)).toBe(
      "https://jobs.lever.co/apply"
    );
    expect(sanitizeApplyUrl("javascript:alert(1)", postingUrl)).toBe(
      postingUrl
    );
  });

  test("loadWatchlist loads seeded watchlist correctly", () => {
    const watchlist = loadWatchlist();
    expect(watchlist.length).toBeGreaterThanOrEqual(10);
    expect(watchlist.some((w) => w.slug === "vercel" && w.provider === "greenhouse")).toBe(true);
    expect(watchlist.some((w) => w.slug === "notion" && w.provider === "ashby")).toBe(true);
    expect(watchlist.some((w) => w.slug === "meesho" && w.provider === "lever")).toBe(true);
  });

  test("loadWatchlist names the file when an explicit path is not valid JSON", () => {
    const dir = makeTempDir();
    const bad = join(dir, "broken.json");
    writeFileSync(bad, "{ not json");

    expect(() => loadWatchlist(bad)).toThrow(/broken\.json is not valid JSON/);
  });

  test("loadWatchlist rejects an explicit path whose JSON is not an array", () => {
    const dir = makeTempDir();
    const obj = join(dir, "object.json");
    writeFileSync(obj, JSON.stringify({ company: "Vercel" }));

    expect(() => loadWatchlist(obj)).toThrow(/must contain a JSON array/);
  });

  test("loadWatchlist with explicit non-existent path throws error without fallback", () => {
    expect(() => loadWatchlist("/nonexistent/watchlist.json")).toThrow(
      /Watchlist file not found/
    );
  });
});
