import { expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CLI_PATH = join(import.meta.dir, "../src/cli.ts")
export const FIXTURES = join(import.meta.dir, "fixtures")

export interface CLIResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Run the documented CLI in a fresh process, optionally with a fetch preload. */
export async function runCLI(args: string[], preload?: string): Promise<CLIResult> {
  const cmd = [process.execPath, "run", ...(preload ? ["--preload", preload] : []), CLI_PATH, ...args]
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

export function parseJSON<T = unknown>(result: CLIResult): T {
  if (result.exitCode !== 0) throw new Error(`CLI exited with code ${result.exitCode}. stderr: ${result.stderr}`)
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    throw new Error(`Failed to parse JSON. stdout: ${result.stdout}\nstderr: ${result.stderr}`)
  }
}

export function parseError(result: CLIResult): { error: string; code: string } {
  expect(result.exitCode).toBe(1)
  expect(result.stdout).toBe("")
  return JSON.parse(result.stderr)
}

/** A preload that fails every request: proves a code path never touches the network. */
export function noNetworkPreload(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kuntarekry-nonet-"))
  const path = join(dir, "no-network.ts")
  writeFileSync(path, `globalThis.fetch = Object.assign(async () => { throw new Error("network access is blocked in tests") }, { preconnect() {} })\n`)
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/**
 * Serve `routes` (path -> body, matched on pathname) from a local server and
 * return a preload that sends https://kuntarekry.fi requests there instead.
 * Any other host is refused, so a test can never reach the live board.
 * `seen` records each request URL as the CLI built it.
 */
export function fakeBoard(routes: Record<string, string | (() => Response)>) {
  const seen: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      const original = req.headers.get("x-original-url") ?? url.href
      seen.push(original)
      const route = routes[url.pathname]
      if (route === undefined) return new Response("not found", { status: 404 })
      return typeof route === "function" ? route() : new Response(route, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    },
  })
  const dir = mkdtempSync(join(tmpdir(), "kuntarekry-fake-"))
  const preload = join(dir, "fetch.ts")
  writeFileSync(preload, `
    const originalFetch = globalThis.fetch
    globalThis.fetch = Object.assign((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin !== "https://kuntarekry.fi") throw new Error("unexpected request to " + url.origin)
      const headers = new Headers(init?.headers)
      headers.set("x-original-url", url.href)
      return originalFetch(${JSON.stringify(server.url.origin)} + url.pathname + url.search, { ...init, headers })
    }, { preconnect() {} })
  `)
  return {
    preload,
    seen,
    stop() {
      server.stop(true)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

