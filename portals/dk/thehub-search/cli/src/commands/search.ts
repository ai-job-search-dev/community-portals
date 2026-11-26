import { apiGet, CLIError, object, toResult, toDetail, renderJobs, stripInvisible, type Format, type Getter, type JobResult } from '../helpers.js'

export interface SearchOpts {
  query?: string; location?: string; country?: string; remote?: boolean
  page: number; limit: number; jobage?: number; sort: 'newest' | 'popular'; format: Format
}
export function searchPath(opts: SearchOpts): string {
  const params = new URLSearchParams({ page: String(opts.page), sorting: opts.sort === 'newest' ? 'newJobs' : 'mostPopular' })
  if (opts.query) params.set('search', opts.query)
  if (opts.location) params.set('location', opts.location)
  if (opts.country || !opts.remote) params.set('countryCode', opts.country ?? 'DK')
  if (opts.remote) params.set('isRemote', 'true')
  return `/v2/jobs?${params}`
}
export async function search(opts: SearchOpts, get: Getter = apiGet, now = Date.now()) {
  const data = object(await get(searchPath(opts)))
  if (!Array.isArray(data.docs) || !Number.isInteger(data.total) || (data.total as number) < 0 || !Number.isInteger(data.pages) || (data.pages as number) < 0) throw new CLIError('The Hub search response is missing its results or pagination')
  const seen = new Set<string>(), jobs: JobResult[] = []
  let malformed = 0, missingDates = 0, unavailable = 0, detailRequests = 0
  for (const raw of data.docs) {
    const job = toResult(raw)
    if (!job) { malformed++; continue }
    if (!seen.has(job.id)) { jobs.push(job); seen.add(job.id) }
  }
  if (data.docs.length && !jobs.length) throw new CLIError('The Hub returned jobs but none could be parsed')
  const results: JobResult[] = []
  const cutoff = opts.jobage ? new Date(now - opts.jobage * 86_400_000).toISOString().slice(0, 10) : null
  // One source page only; no unbounded crawl to fill a filtered result limit.
  for (let job of jobs) {
    if (results.length >= opts.limit) break
    if (cutoff) {
      detailRequests++
      const detail = await get(`/jobs/single/${job.id}`)
      if (detail === null) { unavailable++; continue }
      const full = toDetail(detail, job.id)
      if (full.isActive === false) { unavailable++; continue }
      job = toResult(detail)!
      if (!job.date) { missingDates++; continue }
      if (job.date < cutoff) continue
    }
    results.push(job)
  }
  return stripInvisible({ meta: {
    count: results.length, page: opts.page, total: data.total as number, pages: data.pages as number,
    sourcePageSize: data.limit ?? null, sourceCount: data.docs.length,
    nextPage: opts.page < (data.pages as number) ? opts.page + 1 : null,
    jobage: opts.jobage ?? null, detailRequests, malformed, missingDates, unavailable,
    datesAvailable: cutoff !== null, totalIsBeforeClientFilters: true,
  }, results })
}
export async function runSearch(opts: SearchOpts): Promise<void> {
  const output = await search(opts)
  process.stdout.write((opts.format === 'json' ? JSON.stringify(output, null, 2) : renderJobs(output.results, opts.format)) + '\n')
}
