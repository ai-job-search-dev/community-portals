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
    // If --format were swallowed as the query, the leftover "json" would also be
    // BAD_ARG; the message pins which error it is.
    const result = await runCLI(["search", "-q", "--format", "json"]);
    expectError(result, "BAD_ARG");
    expect(result.stderr).toContain("--query requires a non-empty value");
  });

  test("an unknown or misspelled flag after a value flag is rejected, not taken as the value", async () => {
    expectError(await runCLI(["search", "-q", "--categorie", "x"]), "UNKNOWN_FLAG");
    expectError(await runCLI(["search", "-l", "-worldwide"]), "UNKNOWN_FLAG");
  });

  test("--__proto__ is rejected like any other unknown flag", async () => {
    expectError(await runCLI(["search", "--__proto__=x"]), "UNKNOWN_FLAG");
    expectError(await runCLI(["search", "--constructor", "x"]), "UNKNOWN_FLAG");
  });

  test("--help without a command prints usage and exits 0", async () => {
    const result = await runCLI(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("USAGE");
  });

  test("inherited object keys are not commands", async () => {
    expectError(await runCLI(["constructor", "--x", "1"]), "BAD_CMD");
  });

  test("no command prints usage and a JSON error", async () => {
    const result = await runCLI([]);
    expectError(result, "NO_COMMAND");
    expect(result.stdout).toContain("USAGE");
  });

  test("--category rejects inherited object keys instead of crashing", async () => {
    const result = await runCLI(["search", "--category", "constructor"]);
    expectError(result, "BAD_ARG");
  });
});
