import { BASE_URL, htmlFetch, writeError } from "../http.js"
import { stripInvisible } from "../helpers.js"
import { normalizeVacancyInput, parseDetailPage } from "../parsers.js"
import type { VacancyDetail } from "../types.js"

export type DetailOpts = {
  readonly id: string
  readonly format: "json" | "plain"
}

function renderPlain(detail: VacancyDetail): string {
  return [
    detail.title,
    `${detail.company ?? "—"} · ${detail.location ?? "—"}`,
    `Hours: ${detail.hours ?? "—"} · Deadline: ${detail.deadline ?? "—"}`,
    detail.salary ? `Salary: ${detail.salary}` : "",
    detail.contractType ? `Contract: ${detail.contractType}${detail.contractDuration ? ` (${detail.contractDuration})` : ""}` : "",
    detail.educationLevel ? `Level: ${detail.educationLevel}` : "",
    detail.field ? `Field: ${detail.field}` : "",
    detail.salaryDescription ? `Salary details: ${detail.salaryDescription}` : "",
    "",
    detail.description || "(no description)",
    "",
    detail.applyUrl ? `Apply: ${detail.applyUrl}` : "",
    `URL: ${detail.url}`,
    `id: ${detail.id}`,
  ].filter((line) => line !== "").join("\n")
}

export async function runDetail(options: DetailOpts): Promise<number> {
  const id = normalizeVacancyInput(options.id)
  if (!id) {
    writeError(`could not parse a Werken bij de Overheid vacancy from "${options.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(`${BASE_URL}/vacatures/${encodeURIComponent(id)}`)
    if (html === null) {
      writeError("vacancy not found", "NOT_FOUND")
      return 1
    }
    const detail = stripInvisible({ ...parseDetailPage(html) })
    process.stdout.write(options.format === "plain" ? `${renderPlain(detail)}\n` : `${JSON.stringify(detail, null, 2)}\n`)
    return 0
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error), "DETAIL_FAILED")
    return 1
  }
}
