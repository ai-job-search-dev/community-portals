// Blocks network access. runCLI preloads it into a CLI subprocess by default
// (runCLIWithFixtures passes its own preload, which allows only the fixture
// hosts), and each test file imports it, so in-process tests cannot reach the
// network either: a test that needs fetch must stub it.
globalThis.fetch = (() => {
  throw new Error("network access is blocked in tests");
}) as unknown as typeof fetch;
