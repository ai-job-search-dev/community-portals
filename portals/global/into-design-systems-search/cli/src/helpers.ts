export const MCP_URL = "https://jobs.intodesignsystems.com/mcp"

// The portal-skill contract asks for an honest User-Agent that names the tool
// rather than a browser impersonation, so the board can see who is calling.
export const USER_AGENT = "Mozilla/5.0 (compatible; into-design-systems-cli/1.0)"

export interface PortalResult {
  /** The board slug, or null for a listing with no detail page (see below). */
  id: string | null
  title: string | null
  company: string | null
  location: string | null
  date: string | null
  url: string | null
  detailUrl: string | null
  workType: string | null
  remote: boolean | null
  aiSkills: boolean | null
  postingTextAvailable: boolean | null
  summary: string | null
}

/** Any failure worth reporting to the caller as `{ error, code }` on stderr. */
export class AdapterError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 500
const REQUEST_TIMEOUT_MS = 20_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function parseEventStream(body: string): unknown {
  const data = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .at(-1)
  if (!data) throw new AdapterError("MCP response contained no data event", "MCP_PROTOCOL_ERROR")
  return JSON.parse(data)
}

/**
 * Unwrap a JSON-RPC reply down to the tool's own JSON payload.
 *
 * The server reports failure in three different shapes, and all three have to
 * become a thrown error or the caller will treat them as a posting:
 *   1. a JSON-RPC `error` member (transport/protocol level);
 *   2. `result.isError` with a plain-text message (schema validation);
 *   3. a normal result whose JSON payload is `{ "error": "..." }`
 *      (business logic, e.g. an unknown slug).
 */
export function parseMcpResponse(body: string, contentType = ""): unknown {
  const payload = contentType.includes("text/event-stream") ? parseEventStream(body) : JSON.parse(body)
  const message = asRecord(payload)

  if (message.error) {
    const error = asRecord(message.error)
    throw new AdapterError(asString(error.message) ?? "MCP returned an error", String(error.code ?? "MCP_ERROR"))
  }

  const result = asRecord(message.result)
  const content = Array.isArray(result.content) ? result.content : []
  const text = content.map(asRecord).find((item) => item.type === "text")
  const raw = asString(text?.text)
  if (!raw) throw new AdapterError("MCP result contained no text payload", "MCP_PROTOCOL_ERROR")

  // A tool-level error carries a human-readable string, not JSON, so report it
  // verbatim instead of letting JSON.parse turn it into a syntax error.
  if (result.isError === true) throw new AdapterError(raw, "MCP_TOOL_ERROR")

  const parsed = JSON.parse(raw)
  const toolError = asString(asRecord(parsed).error)
  if (toolError) throw new AdapterError(toolError, "MCP_TOOL_ERROR")
  return parsed
}

export async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const requestBody = JSON.stringify({
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: { name, arguments: args },
  })
  let delay = INITIAL_RETRY_DELAY_MS

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response: Response
    try {
      response = await fetch(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "User-Agent": USER_AGENT,
        },
        body: requestBody,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      // Fail fast rather than retry: one unreachable source must not stall a
      // multi-portal `/scrape` run.
      const detail = error instanceof Error ? error.message : String(error)
      throw new AdapterError(`Could not reach Into Design Systems MCP (${detail})`, "MCP_NETWORK_ERROR")
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === MAX_RETRIES) {
        throw new AdapterError(`MCP HTTP ${response.status}: ${response.statusText}`, "MCP_HTTP_ERROR")
      }
      // Exponential backoff with jitter, so retries from parallel portal calls
      // do not land on the board at the same instant.
      await sleep(delay * (0.5 + Math.random() / 2))
      delay *= 2
      continue
    }

    const body = await response.text()
    if (!response.ok) {
      throw new AdapterError(`MCP HTTP ${response.status}: ${body.slice(0, 240)}`, "MCP_HTTP_ERROR")
    }
    return parseMcpResponse(body, response.headers.get("content-type") ?? "") as T
  }

  throw new AdapterError("MCP request failed after retries", "MCP_HTTP_ERROR")
}

/**
 * Map one `search_jobs` entry onto the portal record.
 *
 * `id` is the board slug and is null for a listing the board holds without
 * posting text: those have no detail page, so `detail` cannot read them, but
 * they still carry title, company, location, date and an apply URL and are
 * kept. Only map a missing value to null; never infer it from another field.
 */
export function normalizeSearchJob(value: unknown): PortalResult {
  const job = asRecord(value)
  const city = asString(job.city)
  const country = asString(job.country)
  return {
    id: asString(job.slug),
    title: asString(job.title),
    company: asString(job.company),
    location: [city, country].filter(Boolean).join(" · ") || null,
    date: asString(job.posted),
    url: asString(job.applyUrl) ?? asString(job.detailUrl),
    detailUrl: asString(job.detailUrl),
    workType: asString(job.workType),
    remote: asBoolean(job.remote),
    aiSkills: asBoolean(job.aiSkills),
    postingTextAvailable: asBoolean(job.postingTextAvailable),
    summary: asString(job.summary),
  }
}

export function writeError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof AdapterError ? error.code : "INTERNAL_ERROR"
  process.stderr.write(JSON.stringify({ error: message, code }) + "\n")
}

/**
 * True only for a real calendar day written as YYYY-MM-DD.
 *
 * The board validates these filters itself and rejects a bad one with a clear
 * message, so this is not compensating for a server gap. It is checked here
 * anyway to fail before the round trip and to report a local typo as
 * BAD_ARGUMENT rather than as a server error.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  // A roundtrip catches shape-valid impossibilities like 2026-13-45 and 2026-02-30.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function daysAgoIso(days: number, now = new Date()): string {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}
