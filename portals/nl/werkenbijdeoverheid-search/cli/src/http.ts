export const BASE_URL = "https://www.werkenbijdeoverheid.nl"

const USER_AGENT = "Mozilla/5.0 (compatible; werkenbijdeoverheid-search-cli/1.0)"
const MAX_RETRIES = 6

export class HttpError extends Error {
  readonly name = "HttpError"

  constructor(
    readonly status: number,
    readonly statusText: string,
  ) {
    super(`request failed: ${status} ${statusText}`)
  }
}

export async function htmlFetch(url: string): Promise<string | null> {
  let delay = 500
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.7",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 404) return null
    if (response.status === 429 || response.status >= 500) {
      if (attempt === MAX_RETRIES) throw new HttpError(response.status, response.statusText)
      await Bun.sleep(delay + Math.floor(Math.random() * 250))
      delay = Math.min(delay * 2, 8_000)
      continue
    }
    if (!response.ok) throw new HttpError(response.status, response.statusText)
    return response.text()
  }
  return null
}

export function writeError(error: string, code: string): void {
  process.stderr.write(`${JSON.stringify({ error, code })}\n`)
}
