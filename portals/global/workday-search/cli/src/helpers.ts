// Shared plumbing for the Workday CLI: the HTTP retry loop, the error shape
// the portal contract requires, and the HTML/text and date helpers the list
// and detail endpoints need. Zero runtime dependencies - Bun's fetch only.

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** An HTTP response the CLI is about to translate into a portal-contract error. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "HttpError"
  }
}

const RETRIES = 4
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 5000
const TIMEOUT_MS = 15000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The wait a 429/503 asks for via `Retry-After`, in ms, or null when absent/unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(date - now, 0)
}

/**
 * Fetch JSON from a Workday endpoint, retrying 429/5xx with exponential backoff
 * as the portal contract requires. A connection failure fails fast with a clear
 * message: retrying a dead host only makes the caller wait. 404 and other 4xx
 * responses are returned as HttpError for the caller to map (NOT_FOUND vs
 * API_ERROR).
 */
export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let delay = RETRY_BASE_MS
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (e) {
      throw new Error(
        `could not reach Workday (${e instanceof Error ? e.message : String(e)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === RETRIES) {
        throw new HttpError(
          response.status,
          `Workday API request failed: ${response.status} ${response.statusText}`,
        )
      }
      const jitter = Math.floor(Math.random() * 250)
      const asked = retryAfterMs(response.headers.get("Retry-After")) ?? 0
      // Waiting less than the server asked is worse than failing: a retry that
      // ignores a long Retry-After deepens the rate limit it was meant to clear.
      if (asked > RETRY_MAX_MS) {
        throw new HttpError(
          response.status,
          `Workday API asked to retry in ${Math.ceil(asked / 1000)}s, past this CLI's ${RETRY_MAX_MS / 1000}s wait ceiling`,
        )
      }
      await sleep(Math.max(delay + jitter, asked))
      delay = Math.min(delay * 2, RETRY_MAX_MS)
      continue
    }

    if (!response.ok) {
      throw new HttpError(
        response.status,
        `Workday API request failed: ${response.status} ${response.statusText}`,
      )
    }

    const body = await response.json().catch(() => null)
    if (body === null) throw new Error("Workday returned an unparseable response body")
    return body as T
  }
  throw new Error("Workday API request failed after retries")
}

/**
 * Characters a reader never sees but a model reading this output does: C0/C1
 * controls other than tab/newline/CR, the soft hyphen, bidi marks and
 * embeddings, zero-width characters, the BOM, variation selectors and Unicode
 * tag characters (which can spell a hidden instruction). Job listings are
 * third-party data, so this is the CLI's output boundary.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a value, recursively. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

/** Convert a code point to a string, dropping out-of-range values instead of throwing. */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

// Common named entities employer ads carry. Workday serves UTF-8, but pasted
// ad markup still arrives with these, and leaving them literal is visible in
// every description. One pass, so `&amp;lt;` stays the text "&lt;" instead of
// decoding twice into "<".
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", AMP: "&", lt: "<", LT: "<", gt: ">", GT: ">",
  quot: '"', QUOT: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  bull: "•", middot: "·", sect: "§", para: "¶",
  copy: "©", reg: "®", trade: "™",
  deg: "°", plusmn: "±", times: "×", divide: "÷",
  frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³",
  micro: "µ", cent: "¢", pound: "£", yen: "¥", euro: "€",
  laquo: "«", raquo: "»", permil: "‰",
  dagger: "†", Dagger: "‡", ensp: " ", emsp: " ", thinsp: " ",
}

/** Decode the HTML entities Workday ads carry, in one pass. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (entity, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X"
      return numericEntity(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10))
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : entity
  })
}

// Quoted attribute values may hold `>` or a close tag; neither is markup, and
// HTML ignores `/>` on non-void elements.
const TAG_ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
])

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: string): boolean {
  for (const m of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase()
    // The HTML parser decodes character references in attribute values, so a
    // browser reads style="display&#58;none" as display:none. Match what the
    // browser sees, not the raw text.
    const value = decodeHtmlEntities(m[2] ?? m[3] ?? m[4] ?? "")
    if (name === "hidden") return true
    if (
      name === "style" &&
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)
    ) {
      return true
    }
  }
  return false
}

/**
 * Drop markup a browser never renders - comments, <script>/<style>/<template>/
 * <noscript> blocks, and elements marked hidden - before tags are stripped. A
 * plain tag strip keeps their text, which hands the model words the posting's
 * reader never saw. CSS-only tricks (off-screen, zero font size, stylesheet
 * classes) need a renderer and are not caught here.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  const open = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)(\\s${TAG_ATTRS})?>`, "g")
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag)) {
      // Skip to the matching close tag, counting nested same-name elements. An
      // unclosed hidden element runs to the end: failing closed drops visible
      // text, failing open would leak the hidden text.
      const same = new RegExp(`<(/?)${tag}\\b${TAG_ATTRS}>`, "gi")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
        if (s[1]) depth--
        else depth++
        if (depth === 0) {
          end = same.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    open.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

/** Render an HTML job description as readable plain text, or null when empty. */
export function htmlToText(html: string): string | null {
  // Tags are stripped BEFORE entities are decoded: an ad that writes
  // `List&lt;T&gt;` shows "List<T>" to its reader, and decoding first would make
  // the tag strip eat `<T>`.
  const text = decodeHtmlEntities(
    visibleHtml(html)
      .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(?:p|div|li|h[1-6]|tr|ul|ol|blockquote)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
  return text || null
}

/** Today's date as YYYY-MM-DD (UTC), the shape every portal CLI emits. */
export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** A YYYY-MM-DD date from an ISO timestamp/date, or null when absent or invalid. */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(0)
  date.setUTCFullYear(Number(y), Number(mo) - 1, Number(d))
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(mo) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    return null
  }
  return `${y}-${mo}-${d}`
}

/**
 * The list endpoint only offers a relative `postedOn` label. Convert it to an
 * approximate YYYY-MM-DD date; "Posted 30+ Days Ago" is unbounded, so it stays
 * null. `detail` prefers the exact `startDate` and only falls back to this.
 */
export function parsePostedOn(label: unknown, now = new Date()): string | null {
  if (typeof label !== "string") return null
  const text = label.trim()
  if (/^posted\s+today$/i.test(text)) return todayIso(now)
  if (/^posted\s+yesterday$/i.test(text)) {
    return todayIso(new Date(now.getTime() - 86_400_000))
  }
  const m = text.match(/^posted\s+(\d+)\s+days?\s+ago$/i)
  if (!m) return null
  const days = Number(m[1])
  // Third-party labels are untrusted: a huge day count makes an Invalid Date,
  // and toISOString() on that throws. Treat it as undated instead.
  if (!Number.isSafeInteger(days) || days > 1_000_000) return null
  const date = new Date(now.getTime() - days * 86_400_000)
  return Number.isNaN(date.getTime()) ? null : todayIso(date)
}

/** The YYYY-MM-DD cutoff for a `--jobage N` filter, at UTC day granularity. */
export function jobageCutoff(days: number, now = new Date()): string {
  const date = new Date(now.getTime() - days * 86_400_000)
  // Out-of-range input must not crash the search; the CLI rejects an oversized
  // --jobage before this runs, so the fallback is for direct callers only.
  return Number.isNaN(date.getTime()) ? "0000-01-01" : todayIso(date)
}
