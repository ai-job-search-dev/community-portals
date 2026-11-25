import { afterEach, describe, expect, test } from "bun:test";
import { runSearch } from "../src/commands/search";
import { runDetail } from "../src/commands/detail";
import { MAX_PAGES, PAGE_SIZE } from "../src/helpers";

// The commands' network seam is apiGet's global fetch, so a stubbed fetch
// exercises the whole path offline: request URL, dedupe, filtering, paging,
// warnings, rendering and exit code.

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

interface Capture {
  stdout: () => string;
  stderr: () => string;
}

function captureOutput(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  process.stdout.write = ((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return { stdout: () => out.join(""), stderr: () => err.join("") };
}

const ID_A = "84d388b6-7656-434c-8862-0312eb6b97ac";
const ID_B = "96601a74-e7b6-469d-8c69-6fdfd1c83bc0";
const URL_A = `https://ats.rippling.com/rippling/jobs/${ID_A}`;
const URL_B = `https://ats.rippling.com/rippling/jobs/${ID_B}`;

const boardItem = (id: string, name: string, location: string, department = "Engineering", workplaceType = "ON_SITE") => ({
  id,
  name,
  url: `https://ats.rippling.com/rippling/jobs/${id}`,
  department: { name: department, displayName: department },
  locations: [{ name: location, country: "United States", workplaceType }],
  language: "en-US",
});

function stubResponses(responses: Record<string, () => Response>): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const match = Object.entries(responses).find(([pattern]) => url.includes(pattern));
    return match ? match[1]() : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { urls };
}

const BOARD = {
  items: [
    boardItem(ID_A, "Backend Engineer", "San Francisco, CA"),
    boardItem(ID_A, "Backend Engineer", "New York, NY"),
    boardItem(ID_B, "Product Designer", "Berlin", "Design"),
  ],
  page: 0,
  pageSize: 1000,
  totalItems: 3,
  totalPages: 1,
};

const DETAIL = {
  uuid: ID_A,
  name: "Backend Engineer",
  description: { company: "<p>About Acme</p>", role: "<p>Build <b>APIs</b>.</p>" },
  workLocations: ["San Francisco, CA", "New York, NY"],
  department: { name: "Engineering" },
  employmentType: { label: "SALARIED_FT", id: "Salaried, full-time" },
  createdOn: "2026-03-31T17:37:26.093000-07:00",
  url: URL_A,
  board: { slug: "rippling" },
  payRangeDetails: [{ location: "US", currency: "USD", frequency: "YEAR", rangeStart: 100, rangeEnd: 200 }],
  companyName: "Acme",
};

const baseSearch = {
  board: "rippling",
  page: 1,
  limit: 25,
  format: "json" as const,
};

describe("runSearch offline", () => {
  test("dedupes one-row-per-location, merges locations and filters by keyword", async () => {
    const requests = stubResponses({ "/api/v2/board/rippling/jobs": () => Response.json(BOARD) });
    const out = captureOutput();

    const code = await runSearch({ ...baseSearch, query: "engineer" });
    expect(code).toBe(0);
    expect(out.stderr()).toBe("");
    expect(requests.urls).toEqual(["https://ats.rippling.com/api/v2/board/rippling/jobs?page=0&pageSize=1000"]);

    const body = JSON.parse(out.stdout());
    expect(body.meta).toEqual({ count: 1, page: 1, total: 1 });
    expect(body.results).toEqual([
      {
        id: `rippling/${ID_A}`,
        title: "Backend Engineer",
        company: "rippling",
        company_slug: "rippling",
        location: "San Francisco, CA, United States · New York, NY, United States",
        locations: ["San Francisco, CA, United States", "New York, NY, United States"],
        date: null,
        url: URL_A,
        department: "Engineering",
      },
    ]);
  });

  test("pages the filtered result set, not the board's rows", async () => {
    stubResponses({ "/api/v2/board/rippling/jobs": () => Response.json(BOARD) });
    const out = captureOutput();

    const code = await runSearch({ ...baseSearch, page: 2, limit: 1 });
    expect(code).toBe(0);
    const body = JSON.parse(out.stdout());
    expect(body.meta).toEqual({ count: 1, page: 2, total: 2 });
    expect(body.results[0].title).toBe("Product Designer");
  });

  test("--remote keeps only postings whose workplace type matches, with OR across modes", async () => {
    const mixed = {
      items: [
        boardItem(ID_A, "Backend Engineer", "San Francisco, CA", "Engineering", "ON_SITE"),
        boardItem(ID_B, "Support Engineer", "Remote (United States)", "Support", "REMOTE"),
        boardItem("hybrid-1", "Data Engineer", "Berlin", "Data", "HYBRID"),
      ],
      page: 0,
      pageSize: 1000,
      totalItems: 3,
      totalPages: 1,
    };
    stubResponses({ "/api/v2/board/rippling/jobs": () => Response.json(mixed) });

    const remoteOut = captureOutput();
    expect(await runSearch({ ...baseSearch, workplace: ["remote"] })).toBe(0);
    const remote = JSON.parse(remoteOut.stdout());
    expect(remote.results.map((r: { title: string }) => r.title)).toEqual(["Support Engineer"]);
    expect(remote.meta.total).toBe(1);

    const mixedOut = captureOutput();
    expect(await runSearch({ ...baseSearch, workplace: ["onsite", "hybrid"] })).toBe(0);
    const both = JSON.parse(mixedOut.stdout());
    expect(both.results.map((r: { title: string }) => r.title)).toEqual(["Backend Engineer", "Data Engineer"]);
    expect(both.meta.total).toBe(2);
  });

  test("a page past the end is empty but still reports the total", async () => {
    stubResponses({ "/api/v2/board/rippling/jobs": () => Response.json(BOARD) });
    const out = captureOutput();

    const code = await runSearch({ ...baseSearch, page: 9 });
    expect(code).toBe(0);
    expect(JSON.parse(out.stdout())).toMatchObject({ meta: { count: 0, page: 9, total: 2 }, results: [] });
  });

  test("keeps walking when totalItems is absent, stopping at the first short page", async () => {
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) => boardItem(`job-${i}`, `Engineer ${i}`, "Remote"));
    const urls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url.href);
      const page = Number(url.searchParams.get("page"));
      return Response.json(
        page === 0
          ? { items: fullPage, page: 0, pageSize: PAGE_SIZE }
          : { items: [boardItem(ID_B, "Product Designer", "Berlin", "Design")], page: 1, pageSize: PAGE_SIZE },
      );
    }) as unknown as typeof fetch;
    const out = captureOutput();

    const code = await runSearch({ ...baseSearch, limit: 1 });
    expect(code).toBe(0);
    expect(urls).toHaveLength(2);
    expect(JSON.parse(out.stdout()).meta.total).toBe(PAGE_SIZE + 1);
    expect(out.stderr()).toBe("");
  });

  test("a full page with no totalItems keeps going to the page cap, then warns", async () => {
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) => boardItem(`job-${i}`, `Engineer ${i}`, "Remote"));
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ items: fullPage });
    }) as unknown as typeof fetch;
    const out = captureOutput();

    const code = await runSearch(baseSearch);
    expect(code).toBe(0);
    expect(calls).toBe(MAX_PAGES);
    const warning = JSON.parse(out.stderr());
    expect(warning.code).toBe("SEARCH_TRUNCATED");
    expect(warning.warning).toContain("page cap");
  });

  test("table and plain formats omit the JSON payload", async () => {
    stubResponses({ "/api/v2/board/rippling/jobs": () => Response.json(BOARD) });
    const out = captureOutput();
    await runSearch({ ...baseSearch, format: "table" });
    expect(out.stdout()).toContain("ID");
    expect(out.stdout()).toContain(`rippling/${ID_A}`);
    expect(out.stdout()).toContain("Backend Engineer");
    expect(out.stdout()).not.toContain('"meta"');

    const plain = captureOutput();
    await runSearch({ ...baseSearch, format: "plain" });
    expect(plain.stdout()).toContain(`id: rippling/${ID_A}`);
    expect(plain.stdout()).toContain(URL_A);
    expect(plain.stdout()).not.toContain('"meta"');
  });

  test("an unknown board is an error, not an empty result set", async () => {
    stubResponses({});
    const out = captureOutput();

    const code = await runSearch(baseSearch);
    expect(code).toBe(1);
    expect(out.stdout()).toBe("");
    const error = JSON.parse(out.stderr());
    expect(error.code).toBe("BOARD_NOT_FOUND");
    expect(error.error).toContain("ats.rippling.com/rippling/jobs");
  });

  test("--jobage warns on stderr and still exits 0, because the board has no dates", async () => {
    stubResponses({ "/api/v2/board/rippling/jobs": () => Response.json(BOARD) });
    const out = captureOutput();

    const code = await runSearch({ ...baseSearch, jobage: 7 });
    expect(code).toBe(0);
    expect(JSON.parse(out.stdout()).results).toHaveLength(2);
    const warning = JSON.parse(out.stderr());
    expect(warning.code).toBe("JOBAGE_UNSUPPORTED");
    expect(warning.warning).toContain("--jobage");
  });

  test("an unexpected response shape is a search failure, not silent emptiness", async () => {
    stubResponses({ "/api/v2/board/rippling/jobs": () => Response.json({ jobs: [] }) });
    const out = captureOutput();

    const code = await runSearch(baseSearch);
    expect(code).toBe(1);
    expect(out.stdout()).toBe("");
    expect(JSON.parse(out.stderr()).code).toBe("SEARCH_FAILED");
  });

  test("a truncated board warns that results may be incomplete", async () => {
    stubResponses({
      "/api/v2/board/rippling/jobs": () =>
        Response.json({ items: [boardItem(ID_A, "Backend Engineer", "Remote")], totalItems: 5000, totalPages: 5 }),
    });
    const out = captureOutput();

    const code = await runSearch(baseSearch);
    expect(code).toBe(0);
    const warning = JSON.parse(out.stderr());
    expect(warning.code).toBe("SEARCH_TRUNCATED");
    expect(warning.warning).toContain("5000");
  });
});

describe("runDetail offline", () => {
  test("returns the full posting with a cleaned description", async () => {
    const requests = stubResponses({ "/api/v1/board/rippling/jobs/": () => Response.json(DETAIL) });
    const out = captureOutput();

    const code = await runDetail({ ref: `rippling/${ID_A}`, format: "json" });
    expect(code).toBe(0);
    expect(requests.urls).toEqual([`https://ats.rippling.com/api/v1/board/rippling/jobs/${ID_A}`]);

    const job = JSON.parse(out.stdout());
    expect(job).toMatchObject({
      id: `rippling/${ID_A}`,
      title: "Backend Engineer",
      company: "Acme",
      location: "San Francisco, CA · New York, NY",
      date: "2026-03-31",
      url: URL_A,
      department: "Engineering",
      employment_type: "Salaried, full-time",
      salary: "USD 100–200/year (US)",
      description: "About Acme\n\nBuild APIs.",
    });
  });

  test("a full posting URL resolves the same way", async () => {
    stubResponses({ "/api/v1/board/rippling/jobs/": () => Response.json(DETAIL) });
    const out = captureOutput();
    const code = await runDetail({ ref: URL_A, format: "json" });
    expect(code).toBe(0);
    expect(JSON.parse(out.stdout()).id).toBe(`rippling/${ID_A}`);
  });

  test("plain format reads as a posting", async () => {
    stubResponses({ "/api/v1/board/rippling/jobs/": () => Response.json(DETAIL) });
    const out = captureOutput();

    const code = await runDetail({ ref: `rippling/${ID_A}`, format: "plain" });
    expect(code).toBe(0);
    expect(out.stdout()).toContain("Backend Engineer");
    expect(out.stdout()).toContain("Acme · San Francisco, CA · New York, NY");
    expect(out.stdout()).toContain("Build APIs.");
    expect(out.stdout()).toContain(`id: rippling/${ID_A}`);
  });

  test("a missing posting is NOT_FOUND with exit 1", async () => {
    stubResponses({});
    const out = captureOutput();

    const code = await runDetail({ ref: `rippling/${ID_A}`, format: "json" });
    expect(code).toBe(1);
    expect(out.stdout()).toBe("");
    expect(JSON.parse(out.stderr()).code).toBe("NOT_FOUND");
  });
});
