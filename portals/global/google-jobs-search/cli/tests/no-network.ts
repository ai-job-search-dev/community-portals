// The only host tests may reach is the loopback fake Apify server. Every other
// request fails before it leaves the process, so a test can never spend the
// user's Apify quota or touch api.apify.com.
const originalFetch = globalThis.fetch

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`network access is blocked in tests (blocked host: ${url.hostname})`)
  }
  return originalFetch(input, init)
}) as typeof fetch
