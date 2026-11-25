import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI, runWithFixtures } from "./helpers";
import { CANONICAL_168023, DETAIL_ROUTES, SITEMAP_ROUTE } from "./routes";

interface SearchOut {
  meta: { count: number; page: number; total: number; numPages: number; listed: number };
  results: Array<Record<string, unknown> & { id: string; title: string; location: string | null; url: string }>;
}

const REQUIRED = ["id", "title", "company", "location", "date", "url"];

describe("search", () => {
  test("no query: every German job entry, contract fields present (null, never omitted), one request", async () => {
    const { result, requests } = await runWithFixtures(["search"], SITEMAP_ROUTE);
    const out = parseJSON<SearchOut>(result);
    expect(result.stderr).toBe("");
    expect(out.meta.listed).toBe(8); // the blog and /fr/ entries are skipped
    expect(out.meta.total).toBe(8);
    for (const r of out.results) for (const k of REQUIRED) expect(k in r).toBe(true);
    expect(out.results[0].company).toBeNull();
    expect(out.results[0].date).toBeNull();
    expect(requests).toEqual(["https://publicjobs.ch/sitemap.xml"]);
  });

  test("results are highest id first; id, title, location and url come from the slug", async () => {
    const { result } = await runWithFixtures(["search"], SITEMAP_ROUTE);
    const out = parseJSON<SearchOut>(result);
    const ids = out.results.map((r) => Number(r.id));
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const r = out.results.find((x) => x.id === "168023")!;
    expect(r.title).toBe("Fachspezialist statistiken und simulationen");
    expect(r.location).toBe("Schwyz");
    expect(r.canton).toBe("SZ");
    expect(r.category).toBe("Informatik / IT");
    expect(r.url).toBe(`https://publicjobs.ch${CANONICAL_168023}`);
  });

  test("--query matches the title slug, umlaut-insensitive", async () => {
    const data = await runWithFixtures(["search", "-q", "data"], SITEMAP_ROUTE);
    expect(parseJSON<SearchOut>(data.result).results.map((r) => r.id)).toEqual(["169768", "168302", "165533"]);
    const umlaut = await runWithFixtures(["search", "-q", "Schulergänzenden"], SITEMAP_ROUTE);
    expect(parseJSON<SearchOut>(umlaut.result).results.map((r) => r.id)).toEqual(["170281"]);
  });

  test("double quotes make an ordered phrase; OR is just another word", async () => {
    const phrase = await runWithFixtures(["search", "-q", '"data engineer"'], SITEMAP_ROUTE);
    expect(parseJSON<SearchOut>(phrase.result).meta.total).toBe(1);
    const reversed = await runWithFixtures(["search", "-q", '"engineer data"'], SITEMAP_ROUTE);
    expect(parseJSON<SearchOut>(reversed.result).meta.total).toBe(0);
    const or = await runWithFixtures(["search", "-q", "statistik OR data"], SITEMAP_ROUTE);
    expect(parseJSON<SearchOut>(or.result).meta.total).toBe(0);
  });

  test("--location takes a canton name, code or English spelling; two letters are codes only", async () => {
    for (const loc of ["Zürich", "zuerich", "Zurich", "ZH"]) {
      const { result } = await runWithFixtures(["search", "-l", loc], SITEMAP_ROUTE);
      expect(parseJSON<SearchOut>(result).results.map((r) => r.id)).toEqual(["165533"]);
    }
    const lu = await runWithFixtures(["search", "-l", "LU"], SITEMAP_ROUTE);
    expect(parseJSON<SearchOut>(lu.result).meta.total).toBe(2);
    const ur = await runWithFixtures(["search", "-l", "UR"], SITEMAP_ROUTE); // never "Thurgau"
    expect(parseJSON<SearchOut>(ur.result).meta.total).toBe(0);
  });

  test("--category filters on the category label", async () => {
    const { result } = await runWithFixtures(["search", "-c", "informatik", "-l", "luzern"], SITEMAP_ROUTE);
    expect(parseJSON<SearchOut>(result).results.map((r) => r.id)).toEqual(["169768"]);
  });

  test("--page and --limit", async () => {
    const limited = await runWithFixtures(["search", "-n", "3"], SITEMAP_ROUTE);
    expect(parseJSON<SearchOut>(limited.result).meta.count).toBe(3);
    const page2 = await runWithFixtures(["search", "--page", "2"], SITEMAP_ROUTE);
    const out = parseJSON<SearchOut>(page2.result);
    expect(out.meta.page).toBe(2);
    expect(out.meta.count).toBe(0);
  });

  test("table and plain formats render", async () => {
    const t = await runWithFixtures(["search", "-q", "statistik", "--format", "table"], SITEMAP_ROUTE);
    expect(t.result.exitCode).toBe(0);
    expect(t.result.stdout).toContain("Praktikant in statistik");
    const p = await runWithFixtures(["search", "-q", "statistik", "--format", "plain"], SITEMAP_ROUTE);
    expect(p.result.stdout).toContain("id: 168023");
  });

  test("a sitemap without job entries exits 1 with SEARCH_FAILED", async () => {
    const { result } = await runWithFixtures(["search"], { "https://publicjobs.ch/sitemap.xml": "expired.json" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).code).toBe("SEARCH_FAILED");
  });

  test("a network failure exits 1 with a JSON error", async () => {
    const result = await runCLI(["search", "-q", "data"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).code).toBe("SEARCH_FAILED");
  });
});

describe("detail", () => {
  test("a bare id follows the site's redirect to the canonical path, then parses the job", async () => {
    const { result, requests } = await runWithFixtures(["detail", "168023"], DETAIL_ROUTES);
    const job = parseJSON<Record<string, unknown>>(result);
    expect(requests).toHaveLength(2);
    expect(job.id).toBe("168023");
    expect(job.title).toBe("Fachspezialist Statistiken und Simulationen");
    expect(job.company).toBe("Personalamt Kanton Schwyz");
    expect(job.location).toBe("Schwyz (SZ)");
    expect(job.workload).toBe("40–60 %");
    expect(job.date).toBe("2026-10-29");
    expect(job.listingEnd).toBe("2026-11-27");
    expect(job.url).toBe(`https://publicjobs.ch${CANONICAL_168023}`);
    expect(String(job.description)).toContain("- Analyse von Steuerdaten");
    expect(job).not.toHaveProperty("contactEmail");
  });

  test("a posting URL is fetched directly, in one request", async () => {
    const { result, requests } = await runWithFixtures(["detail", `https://www.publicjobs.ch${CANONICAL_168023}`], DETAIL_ROUTES);
    expect(parseJSON<Record<string, unknown>>(result).id).toBe("168023");
    expect(requests).toHaveLength(1);
  });

  test("plain format", async () => {
    const { result } = await runWithFixtures(["detail", "168023", "--format", "plain"], DETAIL_ROUTES);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Personalamt Kanton Schwyz · Schwyz (SZ)");
    expect(result.stdout).toContain("Listed until: 2026-11-27 (ad end, not the application deadline)");
  });

  test("an expired posting is NOT_FOUND", async () => {
    const { result } = await runWithFixtures(["detail", "100"], DETAIL_ROUTES);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).code).toBe("NOT_FOUND");
  });

  test("a URL on another host is rejected without a request", async () => {
    const { result, requests } = await runWithFixtures(["detail", "https://example.com/jobs/a/b/1-x"], DETAIL_ROUTES);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).code).toBe("BAD_ID");
    expect(requests).toHaveLength(0);
  });
});

describe("argument errors", () => {
  test.each([
    [["search", "--bogus", "x"], "UNKNOWN_FLAG"],
    [["search", "--jobage", "14"], "UNSUPPORTED_FLAG"],
    [["search", "-q"], "BAD_ARG"],
    [["search", "--limit", "0"], "BAD_ARG"],
    [["search", "--format", "csv"], "BAD_ARG"],
    [["detail"], "NO_ID"],
    [["frobnicate"], "BAD_CMD"],
  ])("%p exits 1 with %s on stderr", async (args, code) => {
    const result = await runCLI(args as string[]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).code).toBe(code);
  });
});
