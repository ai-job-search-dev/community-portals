import { join } from "path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");
const NO_NETWORK = join(import.meta.dir, "no-network.ts");
export const FIXTURES = join(import.meta.dir, "fixtures");

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCLI(args: string[], preload = NO_NETWORK): Promise<CLIResult> {
  const proc = Bun.spawn(["bun", "run", "--preload", preload, CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    // The list cache would otherwise let one test's fixture answer another's request.
    env: { ...process.env, PUBLICJOBS_CACHE_TTL: "0" },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/**
 * Run the real CLI with fetch replaced by a fixture map: each listed URL
 * answers with its saved response, and any other URL fails before reaching
 * the network. Returns the URLs the CLI requested, in order.
 */
export async function runWithFixtures(
  args: string[],
  routes: Record<string, string>,
): Promise<{ result: CLIResult; requests: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "publicjobs-fixture-"));
  const preload = join(dir, "fetch.ts");
  const log = join(dir, "requests.log");
  const map = Object.fromEntries(Object.entries(routes).map(([url, file]) => [url, join(FIXTURES, file)]));
  writeFileSync(preload, `
    import { appendFileSync, readFileSync } from "node:fs";
    const routes = ${JSON.stringify(map)};
    globalThis.fetch = (async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      appendFileSync(${JSON.stringify(log)}, url + "\\n");
      const file = routes[url];
      if (!file) throw new Error("Unexpected fixture request: " + url);
      return new Response(readFileSync(file, "utf8"), { status: 200 });
    });
  `);
  try {
    const result = await runCLI(args, preload);
    const requests = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
    return { result, requests };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function parseJSON<T = unknown>(result: CLIResult): T {
  if (result.exitCode !== 0) {
    throw new Error(`CLI exited with code ${result.exitCode}. stderr: ${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`Failed to parse JSON. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}
