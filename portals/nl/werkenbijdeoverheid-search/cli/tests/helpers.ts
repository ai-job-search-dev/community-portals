import { join } from "node:path"

const CLI_PATH = join(import.meta.dir, "../src/cli.ts")
const NO_NETWORK = join(import.meta.dir, "no-network.ts")

export type CLIResult = {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

/** Run the real CLI with the network blocked: CLI tests never reach the live site. */
export async function runCLI(args: readonly string[], preload = NO_NETWORK): Promise<CLIResult> {
  const child = Bun.spawn(["bun", "run", "--preload", preload, CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

export function parseJSON<T = unknown>(result: CLIResult): T {
  if (result.exitCode !== 0) throw new Error(`CLI exited with code ${result.exitCode}. stderr: ${result.stderr}`)
  return JSON.parse(result.stdout) as T
}
