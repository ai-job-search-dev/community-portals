import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// The validation cases fail before any request. The last test is the exception:
// it passes validation on purpose, reaches fetch, and the default preload makes
// that fetch throw.
function expectJsonError(result: { exitCode: number; stderr: string }, code: string) {
  expect(result.exitCode).toBe(1);
  const err = JSON.parse(result.stderr);
  expect(err.error).toBeTruthy();
  expect(err.code).toBe(code);
}

describe("gupy-cli argument validation", () => {
  test("non-numeric --limit, --page and --jobage exit 1 with BAD_ARG", async () => {
    for (const flag of ["--limit", "--page", "--jobage"]) {
      expectJsonError(await runCLI(["search", "-q", "desenvolvedor", flag, "abc"]), "BAD_ARG");
    }
  });

  test("detail without a URL exits 1 with NO_ID", async () => {
    expectJsonError(await runCLI(["detail"]), "NO_ID");
  });

  test("detail rejects a numeric id and a non-Gupy host before fetching", async () => {
    expectJsonError(await runCLI(["detail", "12899105"]), "BAD_ID");
    expectJsonError(await runCLI(["detail", "https://example.com/job/abc"]), "BAD_ID");
    expectJsonError(await runCLI(["detail", "http://qualitydigital.gupy.io/job/abc"]), "BAD_ID");
  });

  test("an unknown command exits 1 with BAD_CMD", async () => {
    expectJsonError(await runCLI(["apply"]), "BAD_CMD");
  });

  test("fractional, trailing-garbage and zero numbers exit 1 with BAD_ARG", async () => {
    for (const [flag, value] of [["--limit", "10days"], ["--page", "1.5"], ["--jobage", "0.5"], ["--jobage", "0"]]) {
      expectJsonError(await runCLI(["search", "-q", "desenvolvedor", flag, value]), "BAD_ARG");
    }
  });

  test("an unknown or misspelled flag exits 1 with UNKNOWN_FLAG", async () => {
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor", "--locatoin", "Goiânia"]), "UNKNOWN_FLAG");
    expectJsonError(await runCLI(["detail", "https://qualitydigital.gupy.io/job/abc", "--remote", "remote"]), "UNKNOWN_FLAG");
  });

  test("a bare value-taking flag or an unquoted extra word exits 1 with BAD_ARG", async () => {
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor", "--location"]), "BAD_ARG");
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor", "júnior"]), "BAD_ARG");
  });

  test("an invalid --remote or --format exits 1 with BAD_ARG", async () => {
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor", "--remote", "remoto"]), "BAD_ARG");
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor", "--format", "csv"]), "BAD_ARG");
    expectJsonError(await runCLI(["detail", "https://qualitydigital.gupy.io/job/abc", "--format", "table"]), "BAD_ARG");
  });

  test("detail only accepts /job/ paths, not the ones robots.txt disallows", async () => {
    expectJsonError(await runCLI(["detail", "https://qualitydigital.gupy.io/companies/x"]), "BAD_ID");
    expectJsonError(await runCLI(["detail", "https://qualitydigital.gupy.io/candidates"]), "BAD_ID");
  });

  test("a network failure is reported as a JSON error, not a crash", async () => {
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor"]), "SEARCH_FAILED");
  });
});
