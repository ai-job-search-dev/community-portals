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

/** Run the CLI with network access blocked (the default) or under another preload. */
export async function runCLI(args: string[], preload = NO_NETWORK): Promise<CLIResult> {
  // process.execPath: the same Bun binary that runs the tests, not whatever "bun" is on PATH.
  const proc = Bun.spawn([process.execPath, "run", "--preload", preload, CLI_PATH, ...args], {
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

/** Saved responses keyed by "host/path" (no query string). Anything else answers 404. */
export type Routes = Record<string, { body: string | object; status?: number }>;

/**
 * Run the real CLI offline: a preload sends every request for an allowed host
 * to a local server that answers from `routes`, and refuses any other host.
 */
export async function runCLIWithFixtures(
  args: string[],
  routes: Routes,
  allowedHosts: string[],
): Promise<{ result: CLIResult; requests: URL[] }> {
  const requests: URL[] = [];
  const dir = mkdtempSync(join(tmpdir(), "portal-fixtures-"));
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const [host, ...rest] = url.pathname.slice(1).split("/");
        const original = new URL(`https://${host}/${rest.join("/")}${url.search}`);
        requests.push(original);
        const route = routes[`${original.host}${original.pathname}`];
        if (!route) return new Response(JSON.stringify({ ok: false, error: "Document not found" }), { status: 404 });
        const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
        return new Response(body, { status: route.status ?? 200 });
      },
    });
    const preload = join(dir, "fetch.ts");
    writeFileSync(preload, `
      const originalFetch = globalThis.fetch;
      const allowed = new Set(${JSON.stringify(allowedHosts)});
      globalThis.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.protocol !== "https:" || !allowed.has(url.host)) throw new Error("Unexpected request to " + url.host);
        return originalFetch(${JSON.stringify(server.url.origin)} + "/" + url.host + url.pathname + url.search, init);
      };
    `);
    return { result: await runCLI(args, preload), requests };
  } finally {
    server?.stop(true);
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
