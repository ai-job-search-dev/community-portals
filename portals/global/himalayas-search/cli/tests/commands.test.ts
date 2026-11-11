import { afterEach, describe, expect, test } from "bun:test";
import { runSearch } from "../src/commands/search";
import { runDetail } from "../src/commands/detail";
import { apiGet, type HimalayasJob, type HimalayasResponse } from "../src/helpers";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

function captureStdout(): { get: () => string } {
  let buf = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return { get: () => buf };
}

function captureStderr(): { get: () => string } {
  let buf = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  return { get: () => buf };
}

function mockFetch(status: number, body: unknown): void {
  globalThis.fetch = (async () => {
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function sampleJob(overrides: Partial<HimalayasJob> = {}): HimalayasJob {
  return {
    title: "Senior Frontend Engineer",
    excerpt: "Looking for a Senior Frontend Engineer to build web apps.",
    companyName: "Acme Corp",
    companySlug: "acme-corp",
    employmentType: "Full Time",
    minSalary: 120000,
    maxSalary: 150000,
    salaryPeriod: "annual",
    currency: "USD",
    seniority: ["Senior"],
    locationRestrictions: ["Worldwide"],
    categories: ["Developer", "Frontend-Development", "Software-Engineer"],
    description: "<p>We are hiring a <strong>Senior Frontend Engineer</strong>.</p>",
    pubDate: 1789380000,
    applicationLink: "https://himalayas.app/companies/acme-corp/jobs/senior-frontend-engineer-123456",
    guid: "https://himalayas.app/companies/acme-corp/jobs/senior-frontend-engineer-123456",
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

describe("Himalayas runSearch (mocked fetch)", () => {
  test("emits standard contract envelope { meta, results }", async () => {
    const mockData: HimalayasResponse = {
      jobs: [sampleJob()],
      limit: 20,
      offset: 0,
      totalCount: 1,
    };
    mockFetch(200, mockData);
    const out = captureStdout();

    const code = await runSearch({ page: 1, limit: 10, format: "json" });
    expect(code).toBe(0);

    const parsed = JSON.parse(out.get());
    expect(parsed.meta).toEqual({ count: 1, page: 1, scanned_matches: 1 });
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe("senior-frontend-engineer-123456");
    expect(parsed.results[0].site).toBe("himalayas");
    expect(parsed.results[0].title).toBe("Senior Frontend Engineer");
    expect(parsed.results[0].company).toBe("Acme Corp");
    expect(parsed.results[0].salary).toBe("USD 120,000–150,000 annual");
  });

  test("filters by keyword query", async () => {
    const mockData: HimalayasResponse = {
      jobs: [
        sampleJob({
          title: "Backend Engineer",
          excerpt: "Python API developer",
          applicationLink: "https://himalayas.app/companies/acme/jobs/backend-1",
        }),
        sampleJob({
          title: "Senior React Engineer",
          excerpt: "React developer",
          applicationLink: "https://himalayas.app/companies/acme/jobs/react-2",
        }),
      ],
    };
    mockFetch(200, mockData);
    const out = captureStdout();

    const code = await runSearch({ query: "React", page: 1, limit: 10, format: "json" });
    expect(code).toBe(0);

    const parsed = JSON.parse(out.get());
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].title).toBe("Senior React Engineer");
  });

  test("handles network failure with SEARCH_FAILED", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Network offline");
    }) as unknown as typeof fetch;
    const err = captureStderr();

    const code = await runSearch({ page: 1, limit: 10, format: "json" });
    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("SEARCH_FAILED");
  });

  test("apiGet refuses a redirect instead of leaving the host", async () => {
    mockFetch(302, "Redirect");
    await expect(apiGet({ limit: 10, offset: 0 })).rejects.toThrow(/redirect/i);
  });

  test("location aliases match both spellings (USA -> US, GB -> Great Britain)", async () => {
    const jobUS = sampleJob({
      title: "Senior US Engineer",
      applicationLink: "https://himalayas.app/companies/acme/jobs/us-job-1",
      locationRestrictions: ["US"],
    });
    mockFetch(200, { jobs: [jobUS], limit: 20, offset: 0, totalCount: 1 });
    const outUS = captureStdout();

    const codeUS = await runSearch({ location: "USA", page: 1, limit: 10, format: "json" });
    expect(codeUS).toBe(0);
    const parsedUS = JSON.parse(outUS.get());
    expect(parsedUS.results).toHaveLength(1);
    expect(parsedUS.results[0].id).toBe("us-job-1");

    const jobGB = sampleJob({
      title: "Senior UK Engineer",
      applicationLink: "https://himalayas.app/companies/acme/jobs/gb-job-2",
      locationRestrictions: ["Great Britain"],
    });
    mockFetch(200, { jobs: [jobGB], limit: 20, offset: 0, totalCount: 1 });
    const outGB = captureStdout();

    const codeGB = await runSearch({ location: "GB", page: 1, limit: 10, format: "json" });
    expect(codeGB).toBe(0);
    const parsedGB = JSON.parse(outGB.get());
    expect(parsedGB.results).toHaveLength(1);
    expect(parsedGB.results[0].id).toBe("gb-job-2");
  });

  test("a prototype-named location filter does not throw", async () => {
    const job = sampleJob({
      title: "Senior Frontend Engineer",
      applicationLink: "https://himalayas.app/companies/acme/jobs/constructor-job-1",
      locationRestrictions: [],
    });
    mockFetch(200, { jobs: [job], limit: 20, offset: 0, totalCount: 1 });
    const out = captureStdout();

    const code = await runSearch({ location: "constructor", page: 1, limit: 10, format: "json" });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.get());
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe("constructor-job-1");
  });

  test("default tech filter accepts developer/engineering forms but not \"Building\"", async () => {
    const jobs = [
      sampleJob({
        title: "Senior Developers",
        applicationLink: "https://himalayas.app/companies/acme/jobs/dev-1",
        categories: [],
        parentCategories: [],
        excerpt: "",
      }),
      sampleJob({
        title: "Data Engineering",
        applicationLink: "https://himalayas.app/companies/acme/jobs/data-2",
        categories: [],
        parentCategories: [],
        excerpt: "",
      }),
      sampleJob({
        title: "Building Manager",
        applicationLink: "https://himalayas.app/companies/acme/jobs/bldg-3",
        categories: [],
        parentCategories: [],
        excerpt: "",
      }),
    ];
    mockFetch(200, { jobs, limit: 20, offset: 0, totalCount: 3 });
    const out = captureStdout();

    const code = await runSearch({ page: 1, limit: 10, format: "json" });
    expect(code).toBe(0);

    const parsed = JSON.parse(out.get());
    expect(parsed.meta.scanned_matches).toBe(2);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results.map((r: { title: string }) => r.title)).toEqual([
      "Senior Developers",
      "Data Engineering",
    ]);
  });

  test("--page counts filtered matches, so pages do not overlap", async () => {
    const jobs = [
      sampleJob({ title: "Senior Developer 1", applicationLink: "https://himalayas.app/companies/acme/jobs/match-1", categories: [], parentCategories: [], excerpt: "" }),
      sampleJob({ title: "Building Manager 1", applicationLink: "https://himalayas.app/companies/acme/jobs/skip-1", categories: [], parentCategories: [], excerpt: "" }),
      sampleJob({ title: "Senior Developer 2", applicationLink: "https://himalayas.app/companies/acme/jobs/match-2", categories: [], parentCategories: [], excerpt: "" }),
      sampleJob({ title: "Building Manager 2", applicationLink: "https://himalayas.app/companies/acme/jobs/skip-2", categories: [], parentCategories: [], excerpt: "" }),
      sampleJob({ title: "Senior Developer 3", applicationLink: "https://himalayas.app/companies/acme/jobs/match-3", categories: [], parentCategories: [], excerpt: "" }),
      sampleJob({ title: "Building Manager 3", applicationLink: "https://himalayas.app/companies/acme/jobs/skip-3", categories: [], parentCategories: [], excerpt: "" }),
      sampleJob({ title: "Senior Developer 4", applicationLink: "https://himalayas.app/companies/acme/jobs/match-4", categories: [], parentCategories: [], excerpt: "" }),
      sampleJob({ title: "Building Manager 4", applicationLink: "https://himalayas.app/companies/acme/jobs/skip-4", categories: [], parentCategories: [], excerpt: "" }),
      sampleJob({ title: "Senior Developer 5", applicationLink: "https://himalayas.app/companies/acme/jobs/match-5", categories: [], parentCategories: [], excerpt: "" }),
    ];

    // Page 1 with limit 2
    mockFetch(200, { jobs, limit: 20, offset: 0, totalCount: jobs.length });
    const out1 = captureStdout();
    const code1 = await runSearch({ page: 1, limit: 2, format: "json" });
    expect(code1).toBe(0);
    const parsed1 = JSON.parse(out1.get());
    expect(parsed1.meta.scanned_matches).toBe(2);
    expect(parsed1.meta.count).toBe(2);
    expect(parsed1.meta.page).toBe(1);
    expect(parsed1.results.map((r: { id: string }) => r.id)).toEqual(["match-1", "match-2"]);

    // Page 2 with limit 2
    mockFetch(200, { jobs, limit: 20, offset: 0, totalCount: jobs.length });
    const out2 = captureStdout();
    const code2 = await runSearch({ page: 2, limit: 2, format: "json" });
    expect(code2).toBe(0);
    const parsed2 = JSON.parse(out2.get());
    expect(parsed2.meta.scanned_matches).toBe(4);
    expect(parsed2.meta.count).toBe(2);
    expect(parsed2.meta.page).toBe(2);
    expect(parsed2.results.map((r: { id: string }) => r.id)).toEqual(["match-3", "match-4"]);

    // Verify no overlap between page 1 and page 2 results
    const page1Ids = new Set(parsed1.results.map((r: { id: string }) => r.id));
    const page2Ids = parsed2.results.map((r: { id: string }) => r.id);
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }
  });
});

describe("Himalayas runDetail (mocked fetch)", () => {
  test("returns full job detail by slug", async () => {
    const mockData: HimalayasResponse = {
      jobs: [sampleJob()],
    };
    mockFetch(200, mockData);
    const out = captureStdout();

    const code = await runDetail({ id: "senior-frontend-engineer-123456", format: "json" });
    expect(code).toBe(0);

    const parsed = JSON.parse(out.get());
    expect(parsed.id).toBe("senior-frontend-engineer-123456");
    expect(parsed.title).toBe("Senior Frontend Engineer");
    expect(parsed.fullDescription).toContain("Senior Frontend Engineer");
  });

  test("exits 1 with NOT_FOUND when job does not exist", async () => {
    mockFetch(200, { jobs: [] });
    const err = captureStderr();

    const code = await runDetail({ id: "non-existent-slug", format: "json" });
    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("NOT_FOUND");
  });

  test("matches a browser URL with a trailing slash and query string", async () => {
    const job = sampleJob();
    mockFetch(200, { jobs: [job] });
    captureStdout();

    const code = await runDetail({
      id: "https://himalayas.app/companies/acme-corp/jobs/senior-frontend-engineer-123456/?utm_source=feed",
      format: "json",
    });

    expect(code).toBe(0);
  });

  test("does not match a partial id inside the slug", async () => {
    mockFetch(200, { jobs: [sampleJob()] });
    const err = captureStderr();

    const code = await runDetail({ id: "engineer", format: "json" });

    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("NOT_FOUND");
  });

  test("a job with no link never matches an arbitrary id", async () => {
    const job = sampleJob({ applicationLink: undefined, guid: undefined });
    mockFetch(200, { jobs: [job] });
    const err = captureStderr();

    const code = await runDetail({ id: "anything", format: "json" });

    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("NOT_FOUND");
  });
});
