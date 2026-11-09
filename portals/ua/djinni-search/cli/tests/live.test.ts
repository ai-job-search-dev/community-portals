import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

// Live smoke test against djinni.co. Skipped unless DJINNI_LIVE=1, so CI and
// routine `bun test` runs never send requests to the portal:
//   DJINNI_LIVE=1 bun run test

interface Job {
  id: string | null;
  title: string | null;
  url: string | null;
  description?: string | null;
}

describe.skipIf(process.env.DJINNI_LIVE !== "1")("live djinni.co", () => {
  test("search returns real results and detail reads one of them", async () => {
    const search = parseJSON<{ meta: { count: number }; results: Job[] }>(
      await runCLI(["search", "-q", "React", "--employment", "remote", "--limit", "5"]),
    );
    expect(search.meta.count).toBeGreaterThanOrEqual(1);
    for (const job of search.results) {
      expect(job.id).toBeTruthy();
      expect(job.title).toBeTruthy();
      expect(job.url).toStartWith("https://djinni.co/jobs/");
    }

    const detail = parseJSON<Job>(await runCLI(["detail", search.results[0].id!]));
    expect(detail.id).toBe(search.results[0].id);
    expect(detail.description?.length ?? 0).toBeGreaterThan(50);
  });
});