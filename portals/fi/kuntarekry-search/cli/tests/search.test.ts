import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { search, searchPath, type SearchOpts } from "../src/commands/search"
import { parseFilters } from "../src/filters"
import { FIXTURES } from "./helpers"

const searchFixture = await Bun.file(join(FIXTURES, "search.json")).text()
const filters = parseFilters(await Bun.file(join(FIXTURES, "filters.json")).json())
const base: SearchOpts = { page: 1, limit: 20, format: "json" }

function recorder(body: string | null = searchFixture) {
  const paths: string[] = []
  return { paths, get: async (path: string) => (paths.push(path), body) }
}

describe("searchPath", () => {
  test("page 1 is the list itself; page N is the board's /sivuN/ segment", () => {
    expect(searchPath("analyytikko", {}, 1, 20)).toBe("/fi/tyopaikat/?format=json&includeTotal=1&limit=20&desc=analyytikko")
    expect(searchPath(undefined, { region: "39494" }, 3, 48)).toBe("/fi/tyopaikat/sivu3/?format=json&includeTotal=1&limit=48&region=39494")
  })
  test("deadline order maps to the board's publication_end sort", () => {
    expect(searchPath(undefined, {}, 1, 5, "deadline")).toEndWith("&sort=publication_end")
  })
})

describe("search", () => {
  test("returns the contract shape from the captured response", async () => {
    const r = recorder()
    const out = await search({ ...base, query: "harjoittelija" }, { get: r.get })
    expect(r.paths).toEqual(["/fi/tyopaikat/?format=json&includeTotal=1&limit=20&desc=harjoittelija"])
    expect(out.meta).toMatchObject({ count: 3, page: 1, total: 28, nextPage: null, sort: "newest", malformed: 0, filters: [] })
    expect(out.results.map((j) => j.id)).toEqual([
      "korkeakouluharjoittelija-turun-filharmonisen-orkesterin-viestinnan-markkinoinnin-ja-tuotannon-tehtaviin-tku00-44-103-26",
      "korkeakouluharjoittelija-varhaiskasvatuksen-hallintoon-vsa905-02-212-26",
      "korkeakouluharjoittelija-liikuntapalvelut-vsa905-02-203-26",
    ])
    for (const job of out.results) {
      for (const key of ["id", "title", "company", "location", "date", "url"]) expect(job).toHaveProperty(key)
    }
  })

  test("a full page with more jobs behind it points to the next page", async () => {
    const out = await search({ ...base, limit: 3 }, { get: recorder().get })
    expect(out.meta.nextPage).toBe(2)
  })

  test("page 999 is the last page the board serves, so it does not advertise page 1000", async () => {
    // A total large enough that page 1000 would otherwise exist.
    const r = recorder(JSON.stringify({ ...JSON.parse(searchFixture), total: 3000 }))
    const out = await search({ ...base, limit: 3, page: 999 }, { get: r.get })
    expect(r.paths).toEqual(["/fi/tyopaikat/sivu999/?format=json&includeTotal=1&limit=3"])
    expect(out.meta.nextPage).toBeNull()
    const before = await search({ ...base, limit: 3, page: 998 }, { get: recorder(JSON.stringify({ ...JSON.parse(searchFixture), total: 3000 })).get })
    expect(before.meta.nextPage).toBe(999)
  })

  test("resolves filter names before searching and reports what it applied", async () => {
    const r = recorder()
    const out = await search({ ...base, location: "Helsinki,Espoo", type: "internship", orgType: "municipality" }, { get: r.get, load: async () => filters })
    expect(r.paths[0]).toBe("/fi/tyopaikat/?format=json&includeTotal=1&limit=20&location=39500%2C39496&type=53256&organisationtype=992178")
    expect(out.meta.filters).toEqual([
      { kind: "location", title: "Helsinki", id: "39500" },
      { kind: "location", title: "Espoo", id: "39496" },
      { kind: "type", title: "Harjoittelu", id: "53256" },
      { kind: "organisationtype", title: "Kunta", id: "992178" },
    ])
  })

  test("does not load the filter vocabulary when no filter flag is given", async () => {
    let loaded = false
    await search(base, { get: recorder().get, load: async () => ((loaded = true), filters) })
    expect(loaded).toBe(false)
  })

  test("--jobage keeps jobs posted on or after the cutoff and stops paging once it is passed", async () => {
    const out = await search({ ...base, limit: 3, jobage: 2 }, { get: recorder().get, today: "2026-11-25" })
    // Fixture dates: 25.11, 23.11, 23.11. Cutoff 23.11 keeps all three.
    expect(out.meta.cutoff).toBe("2026-11-23")
    expect(out.results).toHaveLength(3)
    const narrow = await search({ ...base, limit: 3, jobage: 1 }, { get: recorder().get, today: "2026-11-25" })
    expect(narrow.results.map((j) => j.date)).toEqual(["2026-11-25"])
    expect(narrow.meta.nextPage).toBeNull()
  })

  test("under --sort deadline an old job does not end the paging", async () => {
    const out = await search({ ...base, limit: 3, jobage: 1, sort: "deadline" }, { get: recorder().get, today: "2026-11-25" })
    expect(out.meta.nextPage).toBe(2)
  })

  test("counts malformed rows and drops duplicates", async () => {
    const data = JSON.parse(searchFixture)
    data.jobs.push({ name: "bad", url: "/elsewhere/", title: "x" }, data.jobs[0])
    const out = await search(base, { get: async () => JSON.stringify(data) })
    expect(out.meta.malformed).toBe(1)
    expect(out.results).toHaveLength(3)
  })

  test("a response without jobs or total, or with only unparseable jobs, is an error", async () => {
    await expect(search(base, { get: async () => "not json" })).rejects.toMatchObject({ code: "BAD_RESPONSE" })
    await expect(search(base, { get: async () => JSON.stringify([]) })).rejects.toMatchObject({ code: "BAD_RESPONSE" })
    await expect(search(base, { get: async () => JSON.stringify({ jobs: [{ name: 1 }], total: 1 }) })).rejects.toThrow(/none could be parsed/)
    await expect(search(base, { get: async () => null })).rejects.toMatchObject({ code: "BAD_RESPONSE" })
  })

  test("an empty result is fine", async () => {
    const out = await search(base, { get: async () => JSON.stringify({ jobs: [], total: 0 }) })
    expect(out).toMatchObject({ meta: { count: 0, total: 0, nextPage: null }, results: [] })
  })

  test("refuses a page size beyond the board's cap", async () => {
    await expect(search({ ...base, limit: 49 }, { get: recorder().get })).rejects.toMatchObject({ code: "BAD_ARG" })
  })
})
