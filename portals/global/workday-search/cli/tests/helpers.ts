import { join } from "path"

const CLI_PATH = join(import.meta.dir, "../src/cli.ts")
const NO_NETWORK = join(import.meta.dir, "no-network.ts")

export interface CLIResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function runCLI(args: string[]): Promise<CLIResult> {
  const proc = Bun.spawn(["bun", "run", "--preload", NO_NETWORK, CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}
