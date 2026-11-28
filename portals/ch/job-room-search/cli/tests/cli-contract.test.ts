import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

describe("job-room CLI error contract", () => {
  test("no command prints help and exits 1", async () => {
    const result = await runCLI([]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("job-room-cli");
    expect(result.stdout).toContain("USAGE");
  });

  test("--help on a command prints help and exits 0", async () => {
    const result = await runCLI(["search", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("SEARCH FLAGS");
  });

  test("an unknown command fails with JSON on stderr", async () => {
    const result = await runCLI(["apply"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: 'Unknown command "apply"',
      code: "BAD_CMD",
    });
  });

  test("detail without an id fails before making a request", async () => {
    const result = await runCLI(["detail"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "detail requires an <id|url>",
      code: "NO_ID",
    });
  });
});
