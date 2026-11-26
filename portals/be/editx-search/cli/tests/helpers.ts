import { join } from "path"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"

const CLI_PATH = join(import.meta.dir, "../src/cli.ts")
const NO_NETWORK = join(import.meta.dir, "no-network.ts")

export interface CLIResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function runCLI(args: string[], preload = NO_NETWORK): Promise<CLIResult> {
  const proc = Bun.spawn(["bun", "run", "--preload", preload, CLI_PATH, ...args], {
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

export interface FixtureReply {
  status?: number
  file?: string // a fixture under tests/fixtures
  body?: unknown
}

/**
 * Run the real CLI against a saved response served over loopback HTTP. The
 * child's preload accepts only api.editx.eu's two endpoints and redirects them
 * to the loopback server, so nothing leaves the machine and an unexpected
 * request fails the test.
 */
export async function runWithFixture(args: string[], reply: FixtureReply): Promise<{ result: CLIResult; requests: URL[] }> {
  const requests: URL[] = []
  const dir = mkdtempSync(join(tmpdir(), "editx-fixture-"))
  let server: ReturnType<typeof Bun.serve> | undefined
  // Everything after the temp dir exists runs inside try, so a failure while
  // starting the server or writing the preload still cleans both up.
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests.push(new URL(request.url))
        const body = reply.file ? await Bun.file(join(import.meta.dir, "fixtures", reply.file)).json() : reply.body
        return Response.json(body, { status: reply.status ?? 200 })
      },
    })
    const preload = join(dir, "fetch.ts")
    writeFileSync(
      preload,
      `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://api.editx.eu" || !(url.pathname === "/api/editx/jobs" || url.pathname.startsWith("/api/editx/job/"))) {
        throw new Error("Unexpected request in fixture test: " + url.href);
      }
      return originalFetch(${JSON.stringify(server.url.origin)} + url.pathname + url.search, init);
    };
  `,
    )
    return { result: await runCLI(args, preload), requests }
  } finally {
    server?.stop(true)
    rmSync(dir, { recursive: true, force: true })
  }
}

export function parseJSON<T = unknown>(result: CLIResult): T {
  if (result.exitCode !== 0) throw new Error(`CLI exited with code ${result.exitCode}. stderr: ${result.stderr}`)
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    throw new Error(`Failed to parse JSON. stdout: ${result.stdout}\nstderr: ${result.stderr}`)
  }
}

export function stderrJSON(result: CLIResult): Array<Record<string, string>> {
  return result.stderr
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, string>)
}
