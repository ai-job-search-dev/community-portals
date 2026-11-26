import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { fakeBoard, FIXTURES, noNetworkPreload, parseError, parseJSON, runCLI } from "./helpers"

const SLUG = "korkeakouluharjoittelija-varhaiskasvatuksen-hallintoon-vsa905-02-212-26"

describe("argument errors exit 1 with JSON on stderr and never touch the network", () => {
  const net = noNetworkPreload()
  afterAll(() => net.cleanup())

  const cases: Array<[string[], string]> = [
    [["frobnicate"], "UNKNOWN_COMMAND"],
    [["search", "--bogus", "x"], "UNKNOWN_FLAG"],
    [["search", "-query", "x"], "UNKNOWN_FLAG"],
    [["search", "--query"], "MISSING_REQUIRED"],
    [["search", "--query", "--limit", "5"], "MISSING_REQUIRED"],
    [["search", "--query", " "], "MISSING_REQUIRED"],
    [["search", "-q", "a", "-q", "b"], "BAD_ARG"],
    [["search", "--limit", "0"], "BAD_ARG"],
    [["search", "--limit", "49"], "BAD_ARG"],
    [["search", "--page", "1.5"], "BAD_ARG"],
    [["search", "--page", "1000"], "BAD_ARG"],
    [["search", "--jobage", "-1"], "MISSING_REQUIRED"],
    [["search", "--format", "xml"], "BAD_ARG"],
    [["search", "--sort", "popular"], "BAD_ARG"],
    [["search", "analyytikko"], "BAD_ARG"],
    [["search", "--help=yes"], "BAD_ARG"],
    [["detail"], "MISSING_REQUIRED"],
    [["detail", "a-1", "b-2"], "MISSING_REQUIRED"],
    [["detail", "https://evil.example/fi/tyopaikat/a-1/"], "BAD_ID"],
    [["detail", "a-1", "--query", "x"], "UNKNOWN_FLAG"],
  ]
  for (const [args, code] of cases) {
    test(`${args.join(" ")} -> ${code}`, async () => {
      const err = parseError(await runCLI(args, net.path))
      expect(err.code).toBe(code)
      expect(typeof err.error).toBe("string")
    })
  }

  test("--help prints usage and exits 0", async () => {
    const r = await runCLI(["--help"], net.path)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("kuntarekry-cli")
    expect(r.stdout).toContain("--location")
  })
})

describe("search and detail against a local copy of the board", () => {
  let board: ReturnType<typeof fakeBoard>

  beforeAll(async () => {
    board = fakeBoard({
      "/fi/tyopaikat/": await Bun.file(join(FIXTURES, "search.json")).text(),
      "/fi/tyopaikat/sivu2/": JSON.stringify({ jobs: [], total: 28 }),
      "/fi/api/filters-data/": await Bun.file(join(FIXTURES, "filters.json")).text(),
      [`/fi/tyopaikat/${SLUG}/`]: await Bun.file(join(FIXTURES, "detail-vaasa-harjoittelija.html")).text(),
      "/fi/tyopaikat/busy-1/": () => new Response("slow down", { status: 403 }),
      // The same posting with its apply button removed, as for an email-only posting.
      "/fi/tyopaikat/email-only-1/": (await Bun.file(join(FIXTURES, "detail-vaasa-harjoittelija.html")).text()).replaceAll("apply-button", "apply-removed"),
    })
  })
  afterAll(() => board.stop())

  test("search JSON carries meta and contract fields", async () => {
    const out = parseJSON<{ meta: Record<string, unknown>; results: Array<Record<string, unknown>> }>(
      await runCLI(["search", "-q", "harjoittelija", "-l", "Uusimaa", "--type", "internship", "--limit", "5"], board.preload),
    )
    expect(out.meta).toMatchObject({ count: 3, page: 1, total: 28 })
    expect(out.results[1]).toMatchObject({ id: SLUG, company: "Vaasan kaupunki", date: "2026-11-23" })
    const searchUrl = board.seen.find((u) => u.includes("format=json&includeTotal"))!
    expect(new URL(searchUrl).searchParams.get("region")).toBe("39494")
    expect(new URL(searchUrl).searchParams.get("type")).toBe("53256")
  })

  test("table and plain formats render every result", async () => {
    const table = await runCLI(["search", "--format", "table"], board.preload)
    expect(table.exitCode).toBe(0)
    expect(table.stdout.split("\n")).toHaveLength(4)
    expect(table.stdout).toStartWith("TITLE\tEMPLOYER\tLOCATION\tPOSTED\tDEADLINE\tURL")
    const plain = await runCLI(["search", "--format", "plain"], board.preload)
    expect(plain.stdout).toContain("Posted: 2026-11-23 · Apply by: 2027-01-06")
  })

  test("--page 2 asks for the /sivu2/ segment", async () => {
    const out = parseJSON<{ meta: { count: number } }>(await runCLI(["search", "--page", "2"], board.preload))
    expect(out.meta.count).toBe(0)
    expect(board.seen.some((u) => new URL(u).pathname === "/fi/tyopaikat/sivu2/")).toBe(true)
  })

  test("an unknown municipality is a BAD_ARG with a suggestion", async () => {
    const err = parseError(await runCLI(["search", "-l", "Helsinkk"], board.preload))
    expect(err).toEqual({ error: 'Unknown --location value "Helsinkk"; did you mean: Helsinki', code: "BAD_ARG" })
  })

  test("detail by slug and by URL return the same job", async () => {
    const bySlug = parseJSON<Record<string, unknown>>(await runCLI(["detail", SLUG], board.preload))
    const byUrl = parseJSON<Record<string, unknown>>(await runCLI(["detail", `https://kuntarekry.fi/fi/tyopaikat/${SLUG}/`], board.preload))
    expect(byUrl).toEqual(bySlug)
    expect(bySlug).toMatchObject({ id: SLUG, jobKey: "VSA905-02-212-26", deadline: "2027-01-06" })
  })

  test("detail plain output has the header lines and the posting", async () => {
    const r = await runCLI(["detail", SLUG, "--format", "plain"], board.preload)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toStartWith("Korkeakouluharjoittelija varhaiskasvatuksen hallintoon\nVaasan kaupunki · Vaasa, Pohjanmaa")
    expect(r.stdout).toContain("Apply: https://www.kuntarekrytointi.fi/")
  })

  test("without an apply link, plain output says so instead of offering the posting URL", async () => {
    const r = await runCLI(["detail", "email-only-1", "--format", "plain"], board.preload)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("Apply: no apply link (see the posting for how to apply)")
    expect(r.stdout).not.toMatch(/^Apply: https?:/m)
  })

  test("a closed or missing posting is NOT_FOUND", async () => {
    expect(parseError(await runCLI(["detail", "gone-123"], board.preload)).code).toBe("NOT_FOUND")
  })

  test("an HTTP error is reported, not printed as a job", async () => {
    expect(parseError(await runCLI(["detail", "busy-1"], board.preload)).code).toBe("HTTP_ERROR")
  })
})
