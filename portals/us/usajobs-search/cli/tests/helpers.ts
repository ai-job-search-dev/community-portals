import { join } from "path"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"

const CLI_PATH = join(import.meta.dir, "../src/cli.ts")
const NO_NETWORK = join(import.meta.dir, "no-network.ts")
const FIXTURE = join(import.meta.dir, "fixtures/search-response.json")

export interface CLIResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function runCLI(args: string[], preload = NO_NETWORK): Promise<CLIResult> {
  const proc = Bun.spawn(
    ["bun", "run", "--preload", preload, CLI_PATH, ...args],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, USAJOBS_API_KEY: "test@example.com" },
    },
  )

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

/** Run search through the CLI with the saved offline fixture. */
export async function runSearchFixture(args: string[]): Promise<{ result: CLIResult; requests: URL[] }> {
  const requests: URL[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push(new URL(request.url))
      return new Response(await Bun.file(FIXTURE).text(), {
        headers: { "Content-Type": "application/json" },
      })
    },
  })

  const dir = mkdtempSync(join(tmpdir(), "usajobs-fixture-"))
  const preload = join(dir, "fetch.ts")
  writeFileSync(
    preload,
    `
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://data.usajobs.gov") throw new Error("unexpected host: " + url.origin);
      return original(${JSON.stringify(server.url.origin)} + url.pathname + url.search, init);
    };
    `,
  )

  try {
    return { result: await runCLI(args, preload), requests }
  } finally {
    server.stop(true)
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Like runSearchFixture but serves a different JSON body per page number.
 * The server reads the `Page` query param and calls pageBody(page) for the response.
 */
export async function runSearchMultiPageFixture(
  args: string[],
  pageBody: (page: number) => object,
): Promise<{ result: CLIResult; requests: URL[] }> {
  const requests: URL[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      requests.push(url)
      const page = parseInt(url.searchParams.get("Page") ?? "1", 10)
      try {
        return new Response(JSON.stringify(pageBody(page)), {
          headers: { "Content-Type": "application/json" },
        })
      } catch {
        return new Response("Internal Server Error", { status: 500 })
      }
    },
  })

  const dir = mkdtempSync(join(tmpdir(), "usajobs-multipage-"))
  const preload = join(dir, "fetch.ts")
  writeFileSync(
    preload,
    `
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://data.usajobs.gov") throw new Error("unexpected host: " + url.origin);
      return original(${JSON.stringify(server.url.origin)} + url.pathname + url.search, init);
    };
    `,
  )

  try {
    return { result: await runCLI(args, preload), requests }
  } finally {
    server.stop(true)
    rmSync(dir, { recursive: true, force: true })
  }
}

export function parseJSON<T = unknown>(result: CLIResult): T {
  if (result.exitCode !== 0) {
    throw new Error(`CLI exited with code ${result.exitCode}. stderr: ${result.stderr}`)
  }
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    throw new Error(`Failed to parse JSON. stdout: ${result.stdout}\nstderr: ${result.stderr}`)
  }
}
