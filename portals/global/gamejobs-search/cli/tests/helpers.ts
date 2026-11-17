import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");
const NO_NETWORK = join(import.meta.dir, "no-network.ts");

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCLI(args: string[], preload = NO_NETWORK): Promise<CLIResult> {
  const proc = Bun.spawn(["bun", "run", "--preload", preload, CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/**
 * Run the real CLI against a local server that serves a saved fixture. The
 * preload rewrites only requests for the expected gamejobs.co path to the local
 * server and throws on anything else, so a test can never reach the live board.
 */
export async function runWithFixture(
  args: string[],
  fixture: string,
  expectedPath: (url: URL) => boolean,
  status = 200,
): Promise<{ result: CLIResult; requests: URL[] }> {
  const requests: URL[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url));
      if (status !== 200) return new Response("", { status });
      return new Response(Bun.file(join(import.meta.dir, "fixtures", fixture)), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "gamejobs-fixture-"));
  const preload = join(dir, "fetch.ts");
  writeFileSync(preload, `
    const originalFetch = globalThis.fetch;
    const check = ${expectedPath.toString()};
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://gamejobs.co" || !check(url)) {
        throw new Error("Unexpected fixture request: " + url.href);
      }
      return originalFetch(${JSON.stringify(server.url.origin)} + url.pathname + url.search, init);
    };
  `);
  try {
    return { result: await runCLI(args, preload), requests };
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}

export function parseJSON<T = unknown>(result: CLIResult): T {
  if (result.exitCode !== 0) {
    throw new Error(
      `CLI exited with code ${result.exitCode}. stderr: ${result.stderr}`
    );
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(
      `Failed to parse JSON. stdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
}
