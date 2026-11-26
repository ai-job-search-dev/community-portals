// Name -> id resolution for Kuntarekry's filters, read from /fi/api/filters-data/.
// The search endpoint filters on numeric ids (region=39494, type=53256); users
// and /scrape pass names ("Uusimaa", "Helsinki", "internship").

import { CLIError, kuntarekryGet } from "./helpers.js"

export interface FilterItem {
  id: string
  title: string
  kind: string // the search parameter it maps to: region, location, type, ...
}

/** Lowercase, strip diacritics except the Finnish letters' identity (ä/ö/å fold to a/o/a too). */
export function foldName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

// English and short aliases for the fixed vocabularies, so `--type internship` works.
export const ALIASES: Record<string, Record<string, string>> = {
  type: {
    internship: "Harjoittelu", trainee: "Harjoittelu", harjoittelu: "Harjoittelu",
    "summer job": "Kesätyö", summer: "Kesätyö", kesatyo: "Kesätyö",
    job: "Työpaikka", gig: "Keikkatyö", apprenticeship: "Oppisopimus", "work trial": "Työkokeilu",
  },
  employment: { permanent: "Vakinainen", "fixed term": "Määräaikainen", temporary: "Määräaikainen" },
  hour: { "full time": "Kokoaikatyö", "part time": "Osa-aikatyö", hourly: "Tuntityö" },
  remote: { full: "Täysi etätyömahdollisuus", partial: "Osittainen etätyömahdollisuus", none: "Ei etätyömahdollisuutta" },
  organisationtype: { wellbeing: "Hyvinvointialue", municipality: "Kunta", company: "Yhtiö", school: "Oppilaitos" },
}

const GROUPS: Array<[string, string]> = [
  // [filters-data key, search parameter]
  ["types", "type"],
  ["employments", "employment"],
  ["hours", "hour"],
  ["remotes", "remote"],
  ["organisationTypes", "organisationtype"],
]

function item(raw: unknown, kind: string): FilterItem | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === "number" || typeof r.id === "string" ? String(r.id) : ""
  const title = typeof r.title === "string" ? r.title.trim() : ""
  return /^\d+$/.test(id) && title ? { id, title, kind } : null
}

/** Flatten filters-data into one list. Regions carry their municipalities as children. */
export function parseFilters(json: unknown): FilterItem[] {
  if (!json || typeof json !== "object" || !Array.isArray((json as Record<string, unknown>).locations)) {
    throw new CLIError("Kuntarekry filter data is missing its locations list", "BAD_RESPONSE")
  }
  const data = json as Record<string, unknown>
  const items: FilterItem[] = []
  for (const region of data.locations as unknown[]) {
    const r = item(region, "region")
    if (r) items.push(r)
    const children = region && typeof region === "object" ? (region as Record<string, unknown>).children : null
    if (Array.isArray(children)) for (const child of children) {
      const c = item(child, "location")
      if (c) items.push(c)
    }
  }
  for (const [key, kind] of GROUPS) {
    const list = data[key]
    if (Array.isArray(list)) for (const raw of list) {
      const i = item(raw, kind)
      if (i) items.push(i)
    }
  }
  return items
}

export async function loadFilters(): Promise<FilterItem[]> {
  const body = await kuntarekryGet("/fi/api/filters-data/", "json")
  if (body === null) throw new CLIError("Kuntarekry filter data was not found", "BAD_RESPONSE")
  try {
    return parseFilters(JSON.parse(body))
  } catch (error) {
    if (error instanceof CLIError) throw error
    throw new CLIError("Kuntarekry returned invalid filter JSON", "BAD_RESPONSE")
  }
}

/**
 * Resolve a comma-separated list of names against the kinds allowed for one
 * flag. Exact (folded) matches win; otherwise a unique prefix match. Unknown
 * or ambiguous names are an error that lists close candidates.
 */
export function resolveNames(input: string, kinds: string[], items: FilterItem[], flag: string): FilterItem[] {
  const pool = items.filter((i) => kinds.includes(i.kind))
  const out: FilterItem[] = []
  for (const part of input.split(",").map((p) => p.trim()).filter(Boolean)) {
    const folded = foldName(part)
    // Own keys only: "constructor" or "toString" must stay unknown names, not inherited functions.
    const alias = kinds.map((k) => (ALIASES[k] && Object.hasOwn(ALIASES[k], folded) ? ALIASES[k][folded] : undefined)).find(Boolean)
    const wanted = alias ? foldName(alias) : folded
    const exact = pool.filter((i) => foldName(i.title) === wanted)
    // A municipality and its region can share a name only in theory; prefer the narrower one.
    const pick = exact.find((i) => i.kind === "location") ?? exact[0]
    if (pick) {
      out.push(pick)
      continue
    }
    const prefix = pool.filter((i) => foldName(i.title).startsWith(wanted))
    if (prefix.length === 1) {
      out.push(prefix[0])
      continue
    }
    // The fixed vocabularies (types, hours, ...) list every valid value; for
    // the 300+ places, list the names that share a prefix or the first letters.
    const fixed = !kinds.includes("region") && !kinds.includes("location")
    const near = prefix.length ? prefix
      : fixed ? pool
      : pool.filter((i) => foldName(i.title).includes(wanted.slice(0, 3)))
    const names = near.slice(0, 12).map((i) => i.title)
    const hint = !names.length ? "" : fixed && !prefix.length ? `; valid values: ${names.join(", ")}` : `; did you mean: ${names.join(", ")}`
    throw new CLIError(`${prefix.length > 1 ? "Ambiguous" : "Unknown"} --${flag} value "${part}"${hint}`, "BAD_ARG")
  }
  if (!out.length) throw new CLIError(`--${flag} requires a value`, "MISSING_REQUIRED")
  return out
}

/** Group resolved filters into search parameters: {region: "39494", location: "39500,39496"}. */
export function filterParams(selected: FilterItem[]): Record<string, string> {
  const params: Record<string, string[]> = {}
  for (const f of selected) {
    const ids = (params[f.kind] ??= [])
    if (!ids.includes(f.id)) ids.push(f.id)
  }
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v.join(",")]))
}
