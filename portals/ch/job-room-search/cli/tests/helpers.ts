import { join } from "path";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run the CLI as a subprocess. Tests stay network-free: every case here fails
 * validation before any request is made. */
export async function runCLI(args: string[]): Promise<CLIResult> {
  // process.execPath, not a bare "bun": run the same binary as the test runner.
  const proc = Bun.spawn([process.execPath, "run", CLI_PATH, ...args], {
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
