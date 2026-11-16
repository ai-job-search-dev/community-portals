// Blocks network access. runCLI preloads it into every CLI subprocess, and each
// test file imports it, so in-process tests cannot reach the network either:
// a test that needs fetch must stub it.
globalThis.fetch = (() => {
  throw new Error("network access is blocked in tests");
}) as unknown as typeof fetch;
