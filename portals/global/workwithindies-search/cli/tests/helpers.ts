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
 * Run the real CLI against a local server that serves saved fixtures by path.
 * The preload rewrites only requests for www.workwithindies.com paths listed in
 * `routes` and throws on anything else, so a test can never reach the live board.
 * A route mapped to a number answers with that status and an empty body.
 */
export async function runWithFixtures(
  args: string[],
  routes: Record<string, string | number>,
): Promise<{ result: CLIResult; requests: URL[] }> {
  const requests: URL[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url);
      const route = routes[url.pathname];
      if (typeof route === "number") return new Response("", { status: route });
      return new Response(Bun.file(join(import.meta.dir, "fixtures", String(route))), {
        headers: { "Content-Type": route.endsWith(".xml") ? "application/rss+xml" : "text/html; charset=utf-8" },
      });
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "workwithindies-fixture-"));
  const preload = join(dir, "fetch.ts");
  writeFileSync(preload, `
    const originalFetch = globalThis.fetch;
    const allowed = ${JSON.stringify(Object.keys(routes))};
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://www.workwithindies.com" || !allowed.includes(url.pathname)) {
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
