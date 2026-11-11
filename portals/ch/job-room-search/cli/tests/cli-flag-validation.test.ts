import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

describe("job-room CLI flag validation", () => {
  test("a non-numeric --page fails before making a request", async () => {
    const result = await runCLI(["search", "--page", "not-a-number"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("--page must be a whole number");
  });

  test("a non-numeric --size fails before making a request", async () => {
    const result = await runCLI(["search", "--size", "many"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("--size must be a whole number");
  });

  test("a non-numeric --workload-min fails before making a request", async () => {
    const result = await runCLI(["search", "--workload-min", "full"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("--workload-min must be a whole number");
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

describe("job-room CLI flag-name and value validation", () => {
  test("an unknown flag is rejected rather than silently dropped", async () => {
    const result = await runCLI(["search", "--cantons", "GE"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("UNKNOWN_FLAG");
    expect(error.error).toContain("--cantons");
  });

  test("--flag=value is accepted as a value, not read as a flag name", async () => {
    const result = await runCLI(["search", "--canton=GE", "--format=yaml"]);
    const error = JSON.parse(result.stderr);

    // Reaching the --format check proves --canton=GE parsed as a value.
    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("--format must be");
  });

  test("an unexpected positional argument is rejected", async () => {
    const result = await runCLI(["search", "geneva"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("unexpected argument");
  });

  test("a value-taking flag given bare is rejected", async () => {
    for (const flag of ["--canton", "--sort", "--query"]) {
      const result = await runCLI(["search", flag]);
      const error = JSON.parse(result.stderr);

      expect(result.exitCode).toBe(1);
      expect(error.code).toBe("BAD_ARG");
      expect(error.error).toContain("requires a non-empty value");
    }
  });

  test("a numeric prefix is not accepted as a number", async () => {
    const result = await runCLI(["search", "--page", "2oops"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("--page must be a whole number");
  });

  test("an out-of-range workload is rejected", async () => {
    const result = await runCLI(["search", "--workload-max", "150"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("between 0 and 100");
  });

  test("contradictory workload bounds are rejected", async () => {
    const result = await runCLI(["search", "--workload-min", "80", "--workload-max", "20"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("must not exceed");
  });

  test("detail rejects a format it cannot produce", async () => {
    const result = await runCLI(["detail", "e75c4b4a-ff96-477c-908b-91fd6416fdfc", "--format", "table"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(error.code).toBe("BAD_ARG");
    expect(error.error).toContain("--format must be json or plain");
  });
});
