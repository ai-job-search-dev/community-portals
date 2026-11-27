import { describe, expect, test } from "bun:test"
import { join } from "path"

// SKILL.md promises that its error-code table lists every code the CLI emits.
// This test pins that promise to the source: it scans src/ for the code
// literals and checks each one appears in the doc table, and that the doc lists
// no code the source does not emit. A new code without a doc update fails here.

const PORTAL = join(import.meta.dir, "../..")
const SRC = join(import.meta.dir, "../src")

async function sourceCodes(): Promise<Set<string>> {
  const codes = new Set<string>()
  const glob = new Bun.Glob("**/*.ts")
  for await (const rel of glob.scan({ cwd: SRC })) {
    const text = await Bun.file(join(SRC, rel)).text()
    // A code is the string in writeError(..., "CODE"), new ApiError(..., "CODE"),
    // a `code: "CODE"` object field, or a catch-block fallback `... : "CODE"`.
    for (const re of [
      /(?:writeError|new ApiError)\((?:[^()]|\([^()]*\))*?"([A-Z_]{3,})"\s*[,)]/gs,
      /\bcode:\s*"([A-Z_]{3,})"/g,
      /\?\s*String\([\s\S]*?\)\s*:\s*"([A-Z_]{3,})"/g,
    ]) {
      for (const m of text.matchAll(re)) codes.add(m[1])
    }
  }
  return codes
}

async function documentedCodes(): Promise<Set<string>> {
  const doc = await Bun.file(join(PORTAL, "SKILL.md")).text()
  const section = doc.split("Error codes:")[1] ?? ""
  const codes = new Set<string>()
  for (const m of section.matchAll(/^\|\s*`([A-Z_]{3,})`/gm)) codes.add(m[1])
  return codes
}

describe("SKILL.md error-code table", () => {
  test("lists every code the source emits, and no others", async () => {
    const source = [...(await sourceCodes())].sort()
    const documented = [...(await documentedCodes())].sort()
    expect(documented).toEqual(source)
  })
})
