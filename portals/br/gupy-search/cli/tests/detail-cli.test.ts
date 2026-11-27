import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJSON, runWithFixture, type FixtureRoute } from "./helpers";

const JOB_URL =
  "https://qualitydigital.gupy.io/job/eyJqb2JJZCI6MTI4OTkxMDUsInNvdXJjZSI6Imd1cHlfcG9ydGFsIn0=?jobBoardSource=gupy_portal";

const DETAIL: FixtureRoute = {
  origin: "https://qualitydigital.gupy.io",
  pathPrefix: "/job/",
  fixture: "detail-qualitydigital-excerpt.html",
  contentType: "text/html",
};

describe("gupy-cli detail (saved career page)", () => {
  test("reads the job from the page's embedded data", async () => {
    const { result, requests } = await runWithFixture(["detail", JOB_URL], DETAIL);
    const job = parseJSON<Record<string, string | null>>(result);
    expect(requests).toHaveLength(1);
    expect(job.id).toBe("12899105");
    expect(job.title).toBe("PESSOA DESENVOLVEDORA SÊNIOR (BACK-END)");
    expect(job.location).toBe("Remoto");
    expect(job.workplaceType).toBe("remote");
    expect(job.description).toContain("Quality Digital");
    expect(job.description).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(job.url).toBe(JOB_URL);
  });

  test("reads the company, deadline and additional-information block from the page data", async () => {
    const { result } = await runWithFixture(["detail", JOB_URL], DETAIL);
    const job = parseJSON<Record<string, string | null>>(result);
    // careerPage.name, registerEndDate and relevantExperiences in the saved page.
    expect(job.company).toBe("Quality Digital");
    expect(job.applicationDeadline).toBe("2027-01-15");
    expect(job.description).toContain("O que você vai encontrar");
  });

  test("falls back to the HTML-encoded JSON-LD block when the page data is missing", async () => {
    const page = readFileSync(join(import.meta.dir, "fixtures", DETAIL.fixture), "utf-8");
    const withoutNextData = page.replace(/<script id="__NEXT_DATA__"[\s\S]*?<\/script>/, "");
    expect(withoutNextData).not.toContain("__NEXT_DATA__");
    const { result } = await runWithFixture(["detail", JOB_URL], { ...DETAIL, body: withoutNextData });
    const job = parseJSON<Record<string, string | null>>(result);
    expect(job.title).toContain("DESENVOLVEDORA");
    expect(job.description).toContain("Quality Digital");
    expect(job.description).not.toMatch(/<\/?[a-z][^>]*>/i);
  });

  test("plain format prints the title and URL", async () => {
    const { result } = await runWithFixture(["detail", JOB_URL, "--format", "plain"], DETAIL);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")[0]).toBe("PESSOA DESENVOLVEDORA SÊNIOR (BACK-END)");
    expect(result.stdout).toContain(`URL: ${JOB_URL}`);
    // Title, company line, blank, workplace type, deadline, blank, description ... blank, URL.
    const lines = result.stdout.split("\n");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe("Workplace type: remote");
    expect(lines[4]).toBe("Deadline: 2027-01-15");
    expect(lines[5]).toBe("");
    expect(lines[6]).not.toBe("");
    expect(result.stdout).toContain(`\n\nURL: ${JOB_URL}`);
  });
});
