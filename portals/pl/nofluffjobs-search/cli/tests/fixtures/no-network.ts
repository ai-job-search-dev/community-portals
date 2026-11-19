// Preloaded into the CLI child process: any request at all throws and is
// recorded on stderr, so a test that expects "no request was made" fails if one is.
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = input instanceof Request ? input.url : String(input)
  process.stderr.write(`UNEXPECTED_REQUEST ${url}\n`)
  throw new Error(`Unexpected request in offline fixture: ${url}`)
}) as unknown as typeof fetch
