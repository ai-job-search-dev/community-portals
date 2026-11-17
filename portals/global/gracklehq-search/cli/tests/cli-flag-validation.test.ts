import { describe, expect, test } from "bun:test";
import { runCLI, type CLIResult } from "./helpers";

function expectError(result: CLIResult, code: string) {
  expect(result.exitCode).toBe(1);
  expect(result.stdout === "" || code === "NO_COMMAND").toBe(true);
  expect(JSON.parse(result.stderr.split("\n").pop() as string).code).toBe(code);
}

describe("argument handling", () => {
  test("a leftover word is rejected, not silently dropped", async () => {
    expectError(await runCLI(["search", "unity"]), "BAD_ARG");
    expectError(await runCLI(["search", "-q", "unity", "developer"]), "BAD_ARG");
    expectError(await runCLI(["detail", "one", "two"]), "BAD_ARG");
  });

  test("a value starting with a dash is taken as the value, not as a flag", async () => {
    // -mobile is the query; the bad --format proves parsing got past it.
    const result = await runCLI(["search", "-q", "-mobile", "--format", "xml"]);
    expectError(result, "BAD_ARG");
    expect(result.stderr).toContain("--format");
  });

  test("--flag=value is accepted", async () => {
    const result = await runCLI(["search", "--query=-mobile", "--format=xml"]);
    expectError(result, "BAD_ARG");
    expect(result.stderr).toContain("--format");
  });

  test("a known flag after a value flag is still a flag", async () => {
    expectError(await runCLI(["search", "-q", "--format", "json"]), "BAD_ARG");
  });

  test("inherited object keys are not commands", async () => {
    expectError(await runCLI(["constructor", "--x", "1"]), "BAD_CMD");
  });

  test("no command prints usage and a JSON error", async () => {
    const result = await runCLI([]);
    expectError(result, "NO_COMMAND");
    expect(result.stdout).toContain("USAGE");
  });
});
