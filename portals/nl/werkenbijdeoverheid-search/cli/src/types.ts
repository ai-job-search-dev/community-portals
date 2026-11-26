export type OutputFormat = "json" | "table" | "plain"

export type VacancyResult = {
  readonly id: string
  readonly title: string
  readonly company: string | null
  readonly location: string | null
  readonly date: string | null
  readonly url: string
  readonly deadline: string | null
  readonly hours: string | null
  readonly salary: string | null
  readonly educationLevel: string | null
  readonly contractType: string | null
  readonly summary: string | null
}

export type SearchPage = {
  readonly total: number
  readonly results: readonly VacancyResult[]
}

export type VacancyDetail = {
  readonly id: string
  readonly title: string
  readonly company: string | null
  readonly location: string | null
  readonly deadline: string | null
  readonly hours: string | null
  readonly salary: string | null
  readonly salaryDescription: string | null
  readonly educationLevel: string | null
  readonly field: string | null
  readonly contractType: string | null
  readonly contractDuration: string | null
  readonly url: string
  readonly applyUrl: string | null
  readonly description: string
}
