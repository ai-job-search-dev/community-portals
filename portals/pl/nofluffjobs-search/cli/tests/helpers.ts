import { join } from "path";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the real CLI in a child process. `preload` is a module Bun loads first, used
 * to replace `fetch` (see fixtures/no-network.ts).
 */
export async function runCLI(args: string[], preload?: string): Promise<CLIResult> {
  const proc = Bun.spawn([process.execPath, "run", ...(preload ? ["--preload", preload] : []), CLI_PATH, ...args], {
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

/** Preload that fails the test (and logs UNEXPECTED_REQUEST) if the CLI makes any request. */
export const NO_NETWORK = join(import.meta.dir, "fixtures/no-network.ts");

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
