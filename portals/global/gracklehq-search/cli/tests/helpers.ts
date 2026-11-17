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

/** A saved response for one "host/path" (no query string), or a bare status / redirect. */
export interface Route {
  file?: string;
  status?: number;
  location?: string;
  type?: string;
}

/**
 * Run the real CLI against a local server that serves saved fixtures. The
 * preload sends only the listed "host/path" requests to the local server (with
 * the original host in a header) and throws on anything else, so a test can
 * never reach a live job board.
 */
export async function runWithRoutes(
  args: string[],
  routes: Record<string, Route>,
): Promise<{ result: CLIResult; requests: Array<{ key: string; accept: string | null }> }> {
  const requests: Array<{ key: string; accept: string | null }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const key = (request.headers.get("x-fixture-host") ?? "") + url.pathname;
      requests.push({ key, accept: request.headers.get("accept") });
      const route = routes[key];
      if (!route) return new Response("no route", { status: 599 });
      if (route.location) return new Response("", { status: route.status ?? 302, headers: { Location: route.location } });
      if (!route.file) return new Response("", { status: route.status ?? 200 });
      const type = route.type ?? (route.file.endsWith(".html") ? "text/html; charset=utf-8" : "application/json");
      return new Response(Bun.file(join(import.meta.dir, "fixtures", route.file)), {
        status: route.status ?? 200,
        headers: { "Content-Type": type },
      });
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "gracklehq-fixture-"));
  const preload = join(dir, "fetch.ts");
  writeFileSync(preload, `
    const originalFetch = globalThis.fetch;
    const allowed = new Set(${JSON.stringify(Object.keys(routes))});
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const key = url.hostname + url.pathname;
      if (url.protocol !== "https:" || !allowed.has(key)) {
        throw new Error("Unexpected fixture request: " + url.href);
      }
      const headers = new Headers(init?.headers);
      headers.set("x-fixture-host", url.hostname);
      return originalFetch(${JSON.stringify(server.url.origin)} + url.pathname + url.search, { ...init, headers });
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
