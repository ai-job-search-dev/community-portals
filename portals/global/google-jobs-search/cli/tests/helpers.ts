import { join } from "path"

const CLI_PATH = join(import.meta.dir, "../src/cli.ts")
const NO_NETWORK = join(import.meta.dir, "no-network.ts")
const RUN_FIXTURE = join(import.meta.dir, "fixtures/run-succeeded.json")
const ITEMS_FIXTURE = join(import.meta.dir, "fixtures/dataset-items.json")

export interface CLIResult {
  stdout: string
  stderr: string
  exitCode: number
}

// The token every test passes. It is not a real Apify token; the fake server
// only checks that a bearer header arrives.
export const TEST_TOKEN = "apify_api_test_token_not_real"

/**
 * Run the real CLI in a child process. `--preload no-network` blocks every host
 * but loopback, so a bug that pointed the CLI at api.apify.com fails loudly
 * instead of spending quota. `env` is merged over the parent's; callers pass
 * GOOGLE_JOBS_SEARCH_API_URL to aim the CLI at the fake server.
 */
export async function runCLI(args: string[], env: Record<string, string | undefined> = {}): Promise<CLIResult> {
  const proc = Bun.spawn(["bun", "run", "--preload", NO_NETWORK, CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
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

export interface RecordedRequest {
  method: string
  path: string
  url: URL
  headers: Headers
  body: string
}

export interface Route {
  status: number
  body: string
  contentType?: string
  headers?: Record<string, string>
}

export interface FakeApify {
  /** The origin to pass as GOOGLE_JOBS_SEARCH_API_URL. */
  origin: string
  requests: RecordedRequest[]
  close: () => void
}

/**
 * Serve captured Actor responses over loopback, so the real CLI exercises the
 * real request building and response reading with no network. `handle` answers
 * each recorded request; it can return a Route or throw to fail the request.
 */
export function startFakeApify(
  handle: (request: RecordedRequest) => Route | Promise<Route>,
): FakeApify {
  const requests: RecordedRequest[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const recorded: RecordedRequest = {
        method: request.method,
        path: url.pathname,
        url,
        headers: request.headers,
        body: await request.text(),
      }
      requests.push(recorded)
      const route = await handle(recorded)
      return new Response(route.body, {
        status: route.status,
        headers: { "Content-Type": route.contentType ?? "application/json", ...(route.headers ?? {}) },
      })
    },
  })
  return {
    origin: `http://127.0.0.1:${server.port}`,
    requests,
    close: () => server.stop(true),
  }
}

/** The dataset page sliced by `offset` and `limit`, the way Apify pages a dataset. */
export async function datasetSlice(offset: number, limit: number): Promise<string> {
  const items = JSON.parse(await Bun.file(ITEMS_FIXTURE).text()) as unknown[]
  return JSON.stringify(items.slice(offset, offset + limit))
}

/** The dataset id recorded in the captured run fixture. */
export const FIXTURE_DATASET_ID = "jPV8SE3dHqcuO2M3C"
export const FIXTURE_RUN_ID = "Ve1rROaIe3i1NgRWS"

/**
 * The default handler for a successful search: the start POST and every run
 * poll answer from the captured run fixture, and the dataset read answers with
 * the fixture records sliced by the requested offset and limit.
 */
export async function successHandler(request: RecordedRequest): Promise<Route> {
  if (request.path.includes("/acts/krammer~google-jobs-scraper/runs")) {
    return { status: 200, body: await Bun.file(RUN_FIXTURE).text() }
  }
  if (request.path.includes("/actor-runs/")) {
    return { status: 200, body: await Bun.file(RUN_FIXTURE).text() }
  }
  if (request.path.includes("/datasets/")) {
    const offset = Number(request.url.searchParams.get("offset") ?? "0")
    const limit = Number(request.url.searchParams.get("limit") ?? "1000")
    return { status: 200, body: await datasetSlice(offset, limit) }
  }
  return { status: 404, body: "not found" }
}
