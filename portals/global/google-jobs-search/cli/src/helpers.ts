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

/**
 * An error with the portal contract's machine-readable code attached. `status`
 * is the HTTP status when the error came from a response, so a caller can map a
 * specific status (for example a dataset 404) to its own contract code.
 */
export class ApiError extends Error {
  code: string
  status?: number
  constructor(message: string, code: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

const UA = "Mozilla/5.0 (compatible; google-jobs-search-cli/1.0)"

// An Actor run request carries waitForFinish=60, so a single response can
// legitimately take a minute. The timeout sits above that; a stalled socket
// still fails instead of hanging the CLI forever.
const REQUEST_TIMEOUT_MS = 120_000

// A successful response is read whole, because a dataset page must parse. The
// cap bounds memory instead of truncating: a page past it is an error, not a
// trimmed body that would fail to parse.
const MAX_BODY_CHARS = 20_000_000
const MAX_ERROR_BODY_CHARS = 500

/**
 * Read a response body as text without buffering it whole first. `limit` caps
 * the characters kept, counted after decoding, so a huge or hostile body cannot
 * fill memory. A successful read that hits the cap throws; an error read stops
 * at the cap and cancels the stream, because only a prefix is reported.
 */
async function readBodyBounded(response: Response, limit: number, truncate: boolean): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder()
  let text = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      // `>` not `>=`: a body exactly at the cap is legitimate and is read to
      // the end; only a body that grows past it is rejected. Memory stays
      // bounded to the cap plus one chunk.
      if (text.length > limit) {
        if (truncate) {
          await reader.cancel()
          return text.slice(0, limit)
        }
        await reader.cancel()
        throw new ApiError(`Apify API response exceeded ${limit} characters and was not read`, "HTTP_ERROR")
      }
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

/**
 * Wait out one retry: the current delay plus 0-499ms jitter, then return the
 * next delay, doubled up to 8s. Both retry paths (a fetch failure and a body
 * read failure) use it, so the schedule stays in one place.
 */
async function waitBeforeRetry(delay: number): Promise<number> {
  const jitter = Math.floor(Math.random() * 500)
  await new Promise((r) => setTimeout(r, delay + jitter))
  return Math.min(delay * 2, 8000)
}

/**
 * A request to the Apify API. Retries 429/5xx with exponential backoff (the
 * portal contract's schedule: 500ms doubling to 8s, six retries); a GET retries
 * on both, a POST only on 429, because a POST that failed with 5xx may already
 * have started a billed run. 401/403 and 402 are classified here because every
 * endpoint answers them the same way. Any other non-2xx is surfaced with a
 * truncated body.
 */
export async function apiRequest(
  path: string,
  init: { method?: string; body?: string; token: string },
): Promise<string> {
  const url = `${baseUrl()}${path}`
  const method = init.method ?? "GET"
  const maxRetries = 6
  let delay = 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        method,
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
    } catch (e) {
      // A network failure or the request timeout is an HTTP-level failure, not
      // a command-specific one. A GET may be retried; a POST must not be, for
      // the same reason as a 5xx: the run may already be started and billed.
      if (method !== "GET") {
        const name = e instanceof Error ? e.name : "Error"
        throw new ApiError(`Apify API request failed (${name}): ${e instanceof Error ? e.message : String(e)}`, "HTTP_ERROR")
      }
      if (attempt === maxRetries) {
        const name = e instanceof Error ? e.name : "Error"
        throw new ApiError(
          `Apify API request failed after ${maxRetries + 1} attempts (${name}): ${e instanceof Error ? e.message : String(e)}`,
          "HTTP_ERROR",
        )
      }
      delay = await waitBeforeRetry(delay)
      continue
    }

    // A POST that failed with 5xx may still have started a run, and every run
    // is billed, so only a 429 (the request was refused, nothing started) is
    // retried for POST. GET is safe to repeat on both.
    const retryable = response.status === 429 || (response.status >= 500 && method === "GET")
    if (retryable) {
      if (attempt === maxRetries) {
        throw new ApiError(
          `Apify API request failed after ${maxRetries + 1} attempts: ${response.status} ${response.statusText}`,
          "HTTP_ERROR",
          response.status,
        )
      }
      delay = await waitBeforeRetry(delay)
      continue
    }

    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        "Apify rejected the APIFY_API_TOKEN (HTTP 401/403). Check the token in Apify Console -> Settings -> API & Integrations.",
        "AUTH",
        response.status,
      )
    }
    if (response.status === 402) {
      throw new ApiError("The Apify account has no remaining quota (HTTP 402).", "QUOTA", response.status)
    }

    if (!response.ok) {
      // A failed read must not hide the status: fall back to an empty body and
      // report the status as usual.
      let body = ""
      try {
        body = await readBodyBounded(response, MAX_ERROR_BODY_CHARS, true)
      } catch {
        body = ""
      }
      throw new ApiError(
        `Apify API request failed: ${response.status} ${response.statusText}: ${body}`,
        "HTTP_ERROR",
        response.status,
      )
    }

    // The body arrives after the status, so a stream that breaks mid-body is a
    // network failure in its own right. An ApiError from the reader (the size
    // cap) is surfaced as-is. Any other failure follows the same rule as a
    // fetch failure: a GET is retried, a POST is not, because the run may
    // already have started.
    try {
      return await readBodyBounded(response, MAX_BODY_CHARS, false)
    } catch (e) {
      if (e instanceof ApiError) throw e
      const name = e instanceof Error ? e.name : "Error"
      const detail = e instanceof Error ? e.message : String(e)
      if (method !== "GET") {
        throw new ApiError(`Apify API request failed while reading the response (${name}): ${detail}`, "HTTP_ERROR")
      }
      if (attempt === maxRetries) {
        throw new ApiError(
          `Apify API request failed after ${maxRetries + 1} attempts (${name}): ${detail}`,
          "HTTP_ERROR",
        )
      }
      delay = await waitBeforeRetry(delay)
      continue
    }
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
  const parsed = parseBody(body)
  // A JSON `null`, or any non-object, has no `.data`; classify it here instead
  // of letting a property access throw a raw TypeError.
  const envelope = (parsed !== null && typeof parsed === "object" ? parsed : {}) as RunEnvelope
  const data = envelope.data
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
 * Normalize a listing's line breaks for plain output: CRLF becomes LF, and a
 * lone CR (a carriage return that would move the cursor to column zero) is
 * dropped. Third-party text must not be able to overwrite earlier terminal
 * output.
 */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "")
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 * Listing text is third-party data, and these arrive raw in a portal's JSON or
 * markup as easily as through a numeric entity.
 *
 * `\p{Default_Ignorable_Code_Point}` covers every code point Unicode marks
 * default-ignorable — a category that includes U+034F COMBINING GRAPHEME
 * JOINER and other invisible characters a hand-written set misses — without
 * touching ordinary whitespace, which is not default-ignorable.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}\p{Default_Ignorable_Code_Point}]/gu

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
  apply_options: Array<{ title: string | null; link: string }>
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
 * An http(s) URL, or null. Actor-supplied links are third-party data: a
 * `javascript:`, `data:` or otherwise malformed value must never reach output.
 * Anything that does not parse or is not `http:`/`https:` is null.
 */
function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null
  } catch {
    return null
  }
}

/**
 * Reshape one dataset record into the contract result. `id` is
 * `<datasetId>:<the record's offset in the dataset>`, which is what `detail`
 * reads back without a second Actor run.
 */
export function toResult(item: unknown, datasetId: string, offset: number): JobResult {
  const record = (item !== null && typeof item === "object" ? item : {}) as Record<string, unknown>

  // An apply option without an http(s) link is dropped, not emitted with a null
  // link: an unusable apply target is not worth handing downstream.
  const applyOptions: Array<{ title: string | null; link: string }> = []
  if (Array.isArray(record.apply_options)) {
    for (const option of record.apply_options) {
      const entry = (option !== null && typeof option === "object" ? option : {}) as Record<string, unknown>
      const link = httpUrl(entry.link)
      if (link !== null) applyOptions.push({ title: str(entry.title), link })
    }
  }

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
