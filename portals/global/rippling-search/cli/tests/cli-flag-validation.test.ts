import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

// Every case here exits before any request, so the suite stays network-free.
function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

const ID = "84d388b6-7656-434c-8862-0312eb6b97ac";

describe("search flag validation", () => {
  test("missing --board exits 1 with NO_BOARD", async () => {
    const result = await runCLI(["search", "-q", "engineer"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(parsedStderr(result.stderr).code).toBe("NO_BOARD");
    expect(parsedStderr(result.stderr).error).toContain("--board");
  });

  test("an empty --board exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "--board", "", "--format", "json"]);
    expect(result.exitCode).toBe(1);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toContain("--board");
  });

  test("an invalid --board value exits 1 with BAD_ARG before any request", async () => {
    const result = await runCLI(["search", "--board", "https://evil.example/rippling/jobs"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
  });

  for (const name of ["jobage", "page", "limit"]) {
    for (const value of ["foo", "0", "1.5", "-1", "1e21"]) {
      test(`--${name} ${value} exits 1 with BAD_ARG instead of being ignored`, async () => {
        const result = await runCLI(["search", "--board", "rippling", `--${name}`, value]);
        expect(result.exitCode).toBe(1);
        const err = parsedStderr(result.stderr);
        expect(err.code).toBe("BAD_ARG");
        expect(err.error).toContain(name);
      });
    }
  }

  test('a query of only quotes (-q \'""\') exits 1 with BAD_ARG instead of running unfiltered', async () => {
    const result = await runCLI(["search", "--board", "rippling", "-q", '""']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toContain("--query");
  });

  test("an unsupported --format exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "--board", "rippling", "--format", "xml"]);
    expect(result.exitCode).toBe(1);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toContain("format");
  });

  test("-b is an alias for --board", async () => {
    const result = await runCLI(["search", "-b", "", "--format", "json"]);
    expect(result.exitCode).toBe(1);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toContain("--board");
  });

  for (const value of ["sideways", "remote,sideways", "", "rem-ote"]) {
    test(`--remote ${JSON.stringify(value)} exits 1 with BAD_ARG before any request`, async () => {
      const result = await runCLI(["search", "--board", "rippling", "--remote", value]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toContain("--remote");
    });
  }

  test("--remote is a search-only flag", async () => {
    const result = await runCLI(["detail", `rippling/${ID}`, "--remote", "remote"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("UNKNOWN_FLAG");
  });

  test("--board and -b together are rejected as a repeated flag", async () => {
    const result = await runCLI(["search", "--board", "rippling", "-b", "other"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toContain("board");
  });

  test("a bogus flag exits 1 with UNKNOWN_FLAG instead of being silently discarded", async () => {
    const result = await runCLI(["search", "--board", "rippling", "--bogus-flag", "xyz"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("UNKNOWN_FLAG");
    expect(err.error).toContain("--bogus-flag");
  });

  // An alias name that matches an Object.prototype member must stay plain text,
  // not resolve to a function whose source ends up in the error message.
  for (const name of ["constructor", "toString", "hasOwnProperty"]) {
    test(`--${name} is reported as its own unknown flag, not native code`, async () => {
      const result = await runCLI(["search", "--board", "rippling", `--${name}`, "x"]);
      expect(result.exitCode).toBe(1);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("UNKNOWN_FLAG");
      expect(err.error).toContain(`--${name}`);
      expect(err.error).not.toContain("native code");
    });
  }

  test("an unexpected positional argument exits 1 with BAD_ARG before any request", async () => {
    const result = await runCLI(["search", "engineer", "--board", "rippling"]);
    expect(result.exitCode).toBe(1);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toContain('"engineer"');
  });
});

describe("detail flag validation", () => {
  test("missing id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("NO_ID");
  });

  test("an unparseable reference exits 1 with BAD_ID (no network)", async () => {
    const result = await runCLI(["detail", "not an id!"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
  });

  test("a bare id without --board exits 1 with BAD_ID (no network)", async () => {
    const result = await runCLI(["detail", ID]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
  });

  test("an unsupported --format exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["detail", `rippling/${ID}`, "--format", "table"]);
    expect(result.exitCode).toBe(1);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toContain("format");
  });

  test("an unexpected positional argument exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["detail", `rippling/${ID}`, "extra"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
  });
});

describe("command dispatch", () => {
  test("an unknown command exits 1 with BAD_CMD", async () => {
    const result = await runCLI(["frobnicate"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
  });

  // Object.prototype keys are not commands: the lookup must not resolve
  // "constructor" to Object's own constructor and throw INTERNAL_ERROR.
  for (const name of ["constructor", "__proto__", "toString"]) {
    test(`"${name}" as a command exits 1 with BAD_CMD, not INTERNAL_ERROR`, async () => {
      const result = await runCLI([name, "--x"]);
      expect(result.exitCode).toBe(1);
      expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
    });
  }

  test("no command prints help and exits 1", async () => {
    const result = await runCLI([]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("--board");
  });

  test("--help prints usage and exits 0", async () => {
    const result = await runCLI(["search", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("USAGE");
  });
});
