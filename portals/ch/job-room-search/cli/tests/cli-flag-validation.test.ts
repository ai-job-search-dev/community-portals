import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

describe("job-room CLI flag validation", () => {
  test("a non-numeric --page fails before making a request", async () => {
    const result = await runCLI(["search", "--page", "not-a-number"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("--page must be a number");
  });

  test("a non-numeric --size fails before making a request", async () => {
    const result = await runCLI(["search", "--size", "many"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("--size must be a number");
  });

  test("a non-numeric --workload-min fails before making a request", async () => {
    const result = await runCLI(["search", "--workload-min", "full"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("--workload-min must be a number");
  });

  test("an unsupported --sort value is rejected locally", async () => {
    const result = await runCLI(["search", "--sort", "relevance"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("--sort must be");
  });

  test("an unsupported --format value is rejected locally", async () => {
    const result = await runCLI(["search", "--format", "yaml"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("--format must be json, table, or plain");
  });
});
