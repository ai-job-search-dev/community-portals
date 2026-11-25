// Preloaded into CLI subprocesses by runCLI. A validation regression that
// reaches the network fails the test instead of hitting a live Workday board.
globalThis.fetch = (() => {
  throw new Error("network disabled in portal CLI tests")
}) as unknown as typeof fetch
