import { asRecord, asString, callTool } from "../helpers.js"

export interface DetailOpts {
  slug: string
  format: "json" | "plain"
}

export function normalizeSlug(input: string): string | null {
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(input)) return input
  const match = input.match(/\/jobs\/([a-z0-9-]+)/i)
  return match?.[1] ?? null
}

function plain(value: unknown): string {
  const job = asRecord(value)
  // Both parts, joined as search does — a city without its country reads as the
  // wrong place when the same name exists in several.
  const city = asString(job.city)
  const country = asString(job.country)
  const location = [city, country].filter(Boolean).join(" · ") || null
  const requirements = Array.isArray(job.requirements) ? job.requirements.map(String).join("\n") : ""
  const salary = asString(job.salary)
  const apply = asString(job.applyUrl) ?? asString(job.detailUrl)
  return [
    asString(job.title) ?? "Untitled role",
    `${asString(job.company) ?? "—"} · ${location ?? "—"}`,
    salary ? `Salary: ${salary}` : "",
    "",
    asString(job.summary) ?? "",
    requirements ? `Requirements:\n${requirements}` : "",
    // Last, so the one action a reader takes from this view is the final line.
    apply ? `\nApply: ${apply}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<void> {
  const job = await callTool<unknown>("get_job", { slug: opts.slug })
  process.stdout.write((opts.format === "plain" ? plain(job) : JSON.stringify(job, null, 2)) + "\n")
}
