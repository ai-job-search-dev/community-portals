import { afterEach, describe, expect, test } from "bun:test";
import { runSearch, type SearchOpts } from "../src/commands/search";
import { runDetail } from "../src/commands/detail";
import { card, detailPage, ld, searchPage } from "./fixtures";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

/** Serve `bodies` in order (status 200 unless a number is given) and capture requests and output. */
function mock(bodies: Array<string | number>) {
  const urls: string[] = [];
  const out = { stdout: "", stderr: "" };
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(typeof input === "string" ? input : input.toString());
    const body = bodies[Math.min(i++, bodies.length - 1)];
    return typeof body === "number" ? new Response("", { status: body }) : new Response(body);
  }) as typeof fetch;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out.stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    out.stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  return { urls, out };
}

const base: SearchOpts = { page: 1, format: "json" };
const onePage = searchPage([card({ id: "900001", title: "Dev", company: "Acme" })], [ld({ id: 900001, title: "Dev" })], 1);

describe("search requests", () => {
  test("maps every filter to Djinni's parameter", async () => {
    const { urls } = mock([onePage]);
    const code = await runSearch({
      ...base,
      query: "next.js",
      category: "Fullstack",
      employment: "remote",
      region: "UKR",
      location: "kyiv",
      salary: 3000,
      publicSalary: true,
      page: 2,
    });
    expect(code).toBe(0);
    const url = new URL(urls[0]);
    expect(url.origin + url.pathname).toBe("https://djinni.co/jobs/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      all_keywords: "next.js",
      search_type: "basic-search",
      primary_keyword: "Fullstack",
      employment: "remote",
      location: "kyiv",
      region: "UKR",
      salary: "3000",
      editorial: "has_public_salary",
      page: "2",
    });
  });

  test("an explicit search type is passed through", async () => {
    const { urls } = mock([onePage]);
    await runSearch({ ...base, query: "LLM", searchType: "full-text" });
    expect(new URL(urls[0]).searchParams.get("search_type")).toBe("full-text");
  });

  test("JSON output carries meta and the contract fields", async () => {
    const { out } = mock([onePage]);
    await runSearch(base);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.meta).toEqual({ count: 1, page: 1, total: 1 });
    for (const key of ["id", "title", "company", "location", "date", "url"]) {
      expect(parsed.results[0]).toHaveProperty(key);
    }
  });

  test("--limit 0 emits zero results", async () => {
    const { out } = mock([onePage]);
    await runSearch({ ...base, limit: 0 });
    expect(JSON.parse(out.stdout).results).toHaveLength(0);
  });

  test("retries a 429 and then succeeds", async () => {
    const { urls, out } = mock([429, onePage]);
    const code = await runSearch(base);
    expect(code).toBe(0);
    expect(urls).toHaveLength(2);
    expect(JSON.parse(out.stdout).meta.count).toBe(1);
  });

  test("a 404 on the search page is an error, not an empty result", async () => {
    const { out } = mock([404]);
    expect(await runSearch(base)).toBe(1);
    expect(out.stdout).toBe("");
    expect(JSON.parse(out.stderr).code).toBe("NOT_FOUND");
  });

  test("a 403 is an error on stderr, not an empty result", async () => {
    const { out } = mock([403]);
    const code = await runSearch(base);
    expect(code).toBe(1);
    expect(out.stdout).toBe("");
    expect(JSON.parse(out.stderr).code).toBe("SEARCH_FAILED");
  });
});

describe("detail requests", () => {
  const page = detailPage({ id: 855979, title: "Full-Stack Engineer", company: "Acme", descriptionHtml: "<p>Hello</p>" });

  test("a bare id fetches the placeholder-slug path", async () => {
    const { urls, out } = mock([page]);
    expect(await runDetail({ id: "855979", format: "json" })).toBe(0);
    expect(urls[0]).toBe("https://djinni.co/jobs/855979-x/");
    expect(JSON.parse(out.stdout).description).toBe("Hello");
  });

  test("a full URL fetches its own slug path on djinni.co", async () => {
    const { urls } = mock([page]);
    await runDetail({ id: "https://www.djinni.co/jobs/855979-full-stack-engineer/?applied=ok", format: "plain" });
    expect(urls[0]).toBe("https://djinni.co/jobs/855979-full-stack-engineer/");
  });

  test("plain output keeps blank lines around the description", async () => {
    const { out } = mock([page]);
    expect(await runDetail({ id: "855979", format: "plain" })).toBe(0);
    expect(out.stdout).toContain("\n\nHello\n\nURL: ");
    expect(out.stdout).not.toContain("\n\n\n");
  });

  test("a 404 is NOT_FOUND on stderr", async () => {
    const { out } = mock([404]);
    expect(await runDetail({ id: "855979", format: "json" })).toBe(1);
    expect(JSON.parse(out.stderr).code).toBe("NOT_FOUND");
  });

  test("an off-host URL is rejected before any request", async () => {
    const { urls, out } = mock([page]);
    expect(await runDetail({ id: "https://boards.greenhouse.io/acme/jobs/855979", format: "json" })).toBe(1);
    expect(urls).toHaveLength(0);
    expect(JSON.parse(out.stderr).code).toBe("BAD_ID");
  });
});
describe("text extraction", () => {
  test("a raw < that opens no tag stays in the text, as in a browser", async () => {
    const page = searchPage([card({ id: "900001", title: "C++ < 3 > 1 Dev", company: "Acme" })], [ld({ id: 900001, title: "x" })], 1);
    const { out } = mock([page]);
    expect(await runSearch(base)).toBe(0);
    expect(JSON.parse(out.stdout).results[0].title).toBe("C++ < 3 > 1 Dev");
  });

  test("a close tag inside an attribute does not cut the description short", async () => {
    const page = detailPage({
      id: 855979,
      title: "Engineer",
      company: "Acme",
      descriptionHtml: '<p><a title="</div>">First</a> line</p><div><p>Second line</p></div>',
    });
    const { out } = mock([page]);
    expect(await runDetail({ id: "855979", format: "json" })).toBe(0);
    const description = JSON.parse(out.stdout).description;
    expect(description).toContain("First line");
    expect(description).toContain("Second line");
  });
});
