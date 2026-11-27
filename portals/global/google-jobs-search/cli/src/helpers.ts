// Data source: the Apify API (JSON). This CLI never talks to google.com: it
// starts the Actor `krammer/google-jobs-scraper`, waits for the run, and reads
// the run's dataset. Every request needs the user's own Apify token, read from
// APIFY_API_TOKEN and sent only as a bearer header.

export const DEFAULT_BASE_URL = "https://api.apify.com/v2"

// The only two environment variables this CLI reads: the token, and a base-URL
// override so the tests can point the CLI at a loopback server.
const TOKEN_ENV = "APIFY_API_TOKEN"
const BASE_URL_ENV = "GOOGLE_JOBS_SEARCH_API_URL"

/** API base URL: GOOGLE_JOBS_SEARCH_API_URL (tests, self-hosting) or the default. */
export function baseUrl(): string {
  const raw = (process.env[BASE_URL_ENV] ?? "").trim()
  return (raw || DEFAULT_BASE_URL).replace(/\/+$/, "")
}

/**
 * The Apify API token from APIFY_API_TOKEN, or null when unset or blank. The
 * token is never accepted as a flag: flags land in shell history and in the
 * process list.
 */
export function apiToken(): string | null {
  const raw = (process.env[TOKEN_ENV] ?? "").trim()
  return raw || null
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** An error with the portal contract's machine-readable code attached. */
export class ApiError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

const UA = "Mozilla/5.0 (compatible; google-jobs-search-cli/1.0)"

// An Actor run request carries waitForFinish=60, so a single response can
// legitimately take a minute. The timeout sits above that; a stalled socket
// still fails instead of hanging the CLI forever.
const REQUEST_TIMEOUT_MS = 120_000

// Responses are JSON and small, except an error body from a proxy. Read at most
// this much text, so a huge or hostile body cannot fill memory.
const MAX_BODY_CHARS = 200_000
const MAX_ERROR_BODY_CHARS = 500

/**
 * A request to the Apify API. Retries 429/5xx with exponential backoff (the
 * portal contract's schedule: 500ms doubling to 8s, six retries). 401/403 and
 * 402 are classified here because every endpoint answers them the same way.
 * Any other non-2xx is surfaced with a truncated body.
 */
export async function apiRequest(
  path: string,
  init: { method?: string; body?: string; token: string },
): Promise<string> {
  const url = `${baseUrl()}${path}`
  const maxRetries = 6
  let delay = 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${init.token}`,
        "User-Agent": UA,
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    // A POST that failed with 5xx may still have started a run, and every run
    // is billed, so only a 429 (the request was refused, nothing started) is
    // retried for POST. GET is safe to repeat on both.
    const retryable = response.status === 429 || (response.status >= 500 && (init.method ?? "GET") === "GET")
    if (retryable) {
      if (attempt === maxRetries) {
        throw new ApiError(
          `Apify API request failed after ${maxRetries + 1} attempts: ${response.status} ${response.statusText}`,
          "HTTP_ERROR",
        )
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }

    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        "Apify rejected the APIFY_API_TOKEN (HTTP 401/403). Check the token in Apify Console -> Settings -> API & Integrations.",
        "AUTH",
      )
    }
    if (response.status === 402) {
      throw new ApiError("The Apify account has no remaining quota (HTTP 402).", "QUOTA")
    }

    const body = (await response.text()).slice(0, MAX_BODY_CHARS)
    if (!response.ok) {
      throw new ApiError(
        `Apify API request failed: ${response.status} ${response.statusText}: ${body.slice(0, MAX_ERROR_BODY_CHARS)}`,
        "HTTP_ERROR",
      )
    }
    return body
  }
  throw new ApiError("Apify API request failed after max retries", "HTTP_ERROR")
}

/** Parse a JSON body, turning a malformed one into a clear error. */
export function parseBody(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new ApiError("Apify API returned a response that is not JSON", "HTTP_ERROR")
  }
}

/** The run states after which Apify does not change a run any more. */
export const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"])

export interface RunInfo {
  id: string
  status: string
  statusMessage: string | null
  defaultDatasetId: string | null
}

interface RunEnvelope {
  data?: {
    id?: unknown
    status?: unknown
    statusMessage?: unknown
    defaultDatasetId?: unknown
  }
}

function readRun(body: string): RunInfo {
  const data = (parseBody(body) as RunEnvelope).data
  if (!data || typeof data.id !== "string" || typeof data.status !== "string") {
    throw new ApiError("Apify API returned a run without an id or status", "HTTP_ERROR")
  }
  return {
    id: data.id,
    status: data.status,
    statusMessage: typeof data.statusMessage === "string" && data.statusMessage ? data.statusMessage : null,
    defaultDatasetId: typeof data.defaultDatasetId === "string" && data.defaultDatasetId ? data.defaultDatasetId : null,
  }
}

/**
 * Start the Actor and wait for a terminal state. The POST already asks Apify to
 * hold the connection for 60s; when the run is still going, the run is polled
 * up to five more times. A run that never reaches a terminal state is
 * RUN_TIMEOUT (the actor may be queued on a busy worker); a terminal state
 * other than SUCCEEDED is RUN_FAILED, carrying the Actor's own statusMessage.
 */
export async function runActor(input: Record<string, unknown>, token: string): Promise<RunInfo> {
  const startBody = await apiRequest("/acts/krammer~google-jobs-scraper/runs?waitForFinish=60", {
    method: "POST",
    body: JSON.stringify(input),
    token,
  })
  let run = readRun(startBody)

  const maxPolls = 5
  for (let poll = 0; !TERMINAL_STATES.has(run.status) && poll < maxPolls; poll++) {
    const pollBody = await apiRequest(`/actor-runs/${encodeURIComponent(run.id)}?waitForFinish=60`, { token })
    run = readRun(pollBody)
  }

  if (!TERMINAL_STATES.has(run.status)) {
    throw new ApiError(
      `Actor run ${run.id} did not finish in time (last status: ${run.status}). It may still be running; check the run in Apify Console.`,
      "RUN_TIMEOUT",
    )
  }
  if (run.status !== "SUCCEEDED") {
    const message = run.statusMessage ? `: ${run.statusMessage}` : ""
    throw new ApiError(`Actor run ${run.id} ended with status ${run.status}${message}`, "RUN_FAILED")
  }
  if (!run.defaultDatasetId) {
    throw new ApiError(`Actor run ${run.id} succeeded but returned no dataset id`, "RUN_FAILED")
  }
  return run
}

/**
 * Read page items from a run's dataset. `clean=true` asks Apify for the records
 * as stored, without its own metadata fields.
 */
export async function fetchDatasetItems(
  datasetId: string,
  offset: number,
  limit: number,
  token: string,
): Promise<unknown[]> {
  const path = `/datasets/${encodeURIComponent(datasetId)}/items?offset=${offset}&limit=${limit}&clean=true`
  const body = parseBody(await apiRequest(path, { token }))
  if (!Array.isArray(body)) {
    throw new ApiError("Apify API returned a dataset page that is not an array", "HTTP_ERROR")
  }
  return body
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 * Listing text is third-party data, and these arrive raw in a portal's JSON or
 * markup as easily as through a numeric entity.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

/**
 * A search result in the portal-skill contract shape. Every field is present;
 * a value the Actor did not return is null, never omitted. The salary and
 * remote fields are a permitted superset of the contract.
 */
export interface JobResult {
  id: string
  title: string | null
  company: string | null
  location: string | null
  date: string | null
  url: string | null
  description: string | null
  salary: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  workMode: string | null
  jobTypes: string[]
  apply_options: Array<{ title: string | null; link: string | null }>
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * The Actor's `postedDate` as the contract's `YYYY-MM-DD`, or null. A bare date
 * passes through; an ISO timestamp is cut to its date part. Anything else is
 * null rather than a guess.
 */
export function contractDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const bare = value.trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(bare) ? bare : null
}

/**
 * Reshape one dataset record into the contract result. `id` is
 * `<datasetId>:<the record's offset in the dataset>`, which is what `detail`
 * reads back without a second Actor run.
 */
export function toResult(item: unknown, datasetId: string, offset: number): JobResult {
  const record = (item !== null && typeof item === "object" ? item : {}) as Record<string, unknown>

  const applyOptions = Array.isArray(record.apply_options)
    ? record.apply_options.map((option) => {
        const entry = (option !== null && typeof option === "object" ? option : {}) as Record<string, unknown>
        return { title: str(entry.title), link: str(entry.link) }
      })
    : []

  const jobTypes = Array.isArray(record.jobTypes)
    ? record.jobTypes.filter((t): t is string => typeof t === "string")
    : []

  return {
    id: `${datasetId}:${offset}`,
    title: str(record.title),
    company: str(record.company),
    location: str(record.location),
    date: contractDate(record.postedDate),
    url: applyOptions[0]?.link ?? null,
    description: str(record.description),
    salary: str(record.salary),
    salaryMin: num(record.salaryMin),
    salaryMax: num(record.salaryMax),
    salaryCurrency: str(record.salaryCurrency),
    salaryPeriod: str(record.salaryPeriod),
    workMode: str(record.workMode),
    jobTypes,
    apply_options: applyOptions,
  }
}

/** The Actor's datePosted value for a posting age in days. */
export function jobageToDatePosted(days: number | undefined): string {
  if (days === undefined) return "any"
  if (days === 1) return "24h"
  if (days <= 3) return "3d"
  if (days <= 7) return "7d"
  if (days <= 30) return "30d"
  return "any"
}

export const COUNTRIES = ["us", "gb", "in", "de"] as const
export type Country = (typeof COUNTRIES)[number]

export const MAX_RESULT_WINDOW = 200

/**
 * A detail id: `<datasetId>:<offset>`. The dataset id is an Apify opaque
 * string; the offset is the record's position in that dataset.
 */
export function parseDetailId(input: string): { datasetId: string; offset: number } | null {
  const m = input.trim().match(/^([A-Za-z0-9_-]+):(\d+)$/)
  if (!m) return null
  const offset = Number(m[2])
  if (!Number.isSafeInteger(offset)) return null
  return { datasetId: m[1], offset }
}
