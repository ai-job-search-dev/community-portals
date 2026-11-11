import { expect, test } from "bun:test"
import { join } from "path"

const cli = join(import.meta.dir, "../src/cli.ts")

// Every case here must be rejected during argument parsing, before any network
// call, so the suite passes with no network access.
async function run(args: string[]) {
  const child = Bun.spawn(["bun", "run", cli, ...args], { stdout: "pipe", stderr: "pipe" })
  return {
    code: await child.exited,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  }
}

test("rejects unknown search flags before making a network call", async () => {
  const result = await run(["search", "--unknown-filter", "x"])
  expect(result.code).toBe(1)
  expect(JSON.parse(result.stderr).code).toBe("BAD_ARGUMENT")
})

test("rejects a detail input that is not a board slug or detail URL", async () => {
  const result = await run(["detail", "https://example.test/not-a-job"])
  expect(result.code).toBe(1)
  expect(JSON.parse(result.stderr).error).toContain("detail requires")
})

test("rejects a --before value the board would silently read as no results", async () => {
  const result = await run(["search", "--before", "last-tuesday"])
  expect(result.code).toBe(1)
  expect(JSON.parse(result.stderr).error).toContain("ISO date")
})

test("rejects a date that is shaped right but is not a real day", async () => {
  // The board accepts it and silently returns the entire board, which is
  // indistinguishable from a filter that worked.
  const result = await run(["search", "--before", "2026-13-45"])
  expect(result.code).toBe(1)
  expect(JSON.parse(result.stderr).error).toContain("real ISO date")
})

test("rejects a date window that cannot contain anything", async () => {
  const result = await run(["search", "--jobage", "7", "--before", "2026-01-01"])
  expect(result.code).toBe(1)
  expect(JSON.parse(result.stderr).error).toContain("window is empty")
})

test("rejects a work arrangement the board does not model", async () => {
  const result = await run(["search", "--remote", "anywhere"])
  expect(result.code).toBe(1)
  expect(JSON.parse(result.stderr).code).toBe("BAD_ARGUMENT")
})
