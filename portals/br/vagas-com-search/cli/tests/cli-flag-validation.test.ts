import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// Every case fails before any request: the default preload throws on fetch.
function expectJsonError(result: { exitCode: number; stderr: string }, code: string) {
  expect(result.exitCode).toBe(1);
  const err = JSON.parse(result.stderr);
  expect(err.error).toBeTruthy();
  expect(err.code).toBe(code);
}

describe("vagas-com-cli argument validation", () => {
  test("search without --query exits 1 with NO_QUERY", async () => {
    expectJsonError(await runCLI(["search"]), "NO_QUERY");
  });

  test("non-numeric --limit, --page and --jobage exit 1 with BAD_ARG", async () => {
    for (const flag of ["--limit", "--page", "--jobage"]) {
      expectJsonError(await runCLI(["search", "-q", "desenvolvedor", flag, "abc"]), "BAD_ARG");
    }
  });

  test("detail without an id exits 1 with NO_ID", async () => {
    expectJsonError(await runCLI(["detail"]), "NO_ID");
  });

  test("detail rejects input with no job id before fetching", async () => {
    expectJsonError(await runCLI(["detail", "desenvolvedor"]), "BAD_ID");
  });

  test("an unknown command exits 1 with BAD_CMD", async () => {
    expectJsonError(await runCLI(["apply"]), "BAD_CMD");
    for (const cmd of ["constructor", "__proto__", "toString"]) {
      expectJsonError(await runCLI([cmd]), "BAD_CMD");
    }
  });

  test("fractional, trailing-garbage and zero numbers exit 1 with BAD_ARG", async () => {
    for (const [flag, value] of [["--jobage", "0.5"], ["--limit", "10days"], ["--page", "1.5"], ["--jobage", "0"]]) {
      expectJsonError(await runCLI(["search", "-q", "desenvolvedor", flag, value]), "BAD_ARG");
    }
  });

  test("an unknown or misspelled flag exits 1 with UNKNOWN_FLAG", async () => {
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor", "--locatoin", "Goiânia"]), "UNKNOWN_FLAG");
    expectJsonError(await runCLI(["detail", "2841827", "--jobage", "7"]), "UNKNOWN_FLAG");
  });

  test("an unquoted extra word exits 1 with BAD_ARG", async () => {
    expectJsonError(await runCLI(["search", "-q", "programador", "trainee"]), "BAD_ARG");
    expectJsonError(await runCLI(["detail", "2841827", "extra"]), "BAD_ARG");
  });

  test("a bare or empty --location exits 1 with BAD_ARG", async () => {
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor", "--location"]), "BAD_ARG");
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor", "--location", " "]), "BAD_ARG");
  });

  test("a query or location with no letters or digits is rejected before fetching", async () => {
    expectJsonError(await runCLI(["search", "-q", "!!!"]), "NO_QUERY");
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor", "-l", "..."]), "BAD_ARG");
  });

  test("an unsupported --format exits 1 with BAD_ARG", async () => {
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor", "--format", "csv"]), "BAD_ARG");
    expectJsonError(await runCLI(["detail", "2841827", "--format", "table"]), "BAD_ARG");
  });

  test("a network failure is reported as a JSON error, not a crash", async () => {
    expectJsonError(await runCLI(["search", "-q", "desenvolvedor"]), "SEARCH_FAILED");
  });
});
