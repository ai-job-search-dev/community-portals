import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// Every case here fails validation before any request, so the suite is offline.

function stderrJSON(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

async function expectBadArg(args: string[], code: string, message?: RegExp) {
  const result = await runCLI(args);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  const err = stderrJSON(result.stderr);
  expect(err.code).toBe(code);
  if (message) expect(err.error).toMatch(message);
}

describe("Djinni CLI flag validation", () => {
  test("an unknown flag is rejected, never ignored", () => expectBadArg(["search", "--remote", "true"], "UNKNOWN_FLAG", /--remote/));

  test("an unknown category is rejected with suggestions", () =>
    expectBadArg(["search", "-c", "React"], "BAD_ARG", /React\.js, React Native/));

  test("an unknown city is rejected", () => expectBadArg(["search", "-l", "warsaw"], "BAD_ARG", /city slug/));

  test("an unknown region is rejected", () => expectBadArg(["search", "--region", "asia"], "BAD_ARG", /region/));

  test("an unknown employment mode is rejected", () => expectBadArg(["search", "--employment", "hybrid"], "BAD_ARG", /employment/));

  test("--search-type without --query is rejected", () =>
    expectBadArg(["search", "--search-type", "full-text"], "BAD_ARG", /--query/));

  test("--public-salary takes no value", () => expectBadArg(["search", "--public-salary", "yes"], "BAD_ARG", /no value/));

  test("an empty --query is rejected", () => expectBadArg(["search", "-q", ""], "BAD_ARG", /query/));

  test("a bare --category is rejected", () => expectBadArg(["search", "-c"], "BAD_ARG", /category/));

  for (const name of ["jobage", "page", "limit", "salary"]) {
    test(`--${name} must be a whole number of at least 1`, async () => {
      await expectBadArg(["search", `--${name}`, "1.5"], "BAD_ARG", new RegExp(name));
      await expectBadArg(["search", `--${name}`, "0"], "BAD_ARG", new RegExp(name));
    });
  }

  test("a bad --format is rejected", () => expectBadArg(["search", "--format", "csv"], "BAD_ARG", /format/));

  test("an unquoted multi-word value is rejected, not truncated", () =>
    expectBadArg(["search", "-q", "React", "Native"], "BAD_ARG", /"Native"/));

  test("a stray argument after the detail id is rejected", () =>
    expectBadArg(["detail", "123456", "extra"], "BAD_ARG", /"extra"/));

  test("detail without an id is NO_ID", () => expectBadArg(["detail"], "NO_ID"));

  test("detail with an off-host URL is BAD_ID", () => expectBadArg(["detail", "https://jobs.lever.co/acme/855979"], "BAD_ID"));

  test("an unknown command is BAD_CMD", () => expectBadArg(["frobnicate"], "BAD_CMD"));

  test("no command prints help and exits 1", async () => {
    const result = await runCLI([]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("USAGE");
  });
});