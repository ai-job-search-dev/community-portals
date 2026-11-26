import { apiGet, CLIError, normalizeId, stripInvisible, toDetail, type Format, type Getter } from '../helpers.js'

export async function detail(input: string, get: Getter = apiGet) {
  const id = normalizeId(input)
  if (!id) throw new CLIError('Expected a 24-character job ID or a thehub.io/jobs/<id> URL', 'BAD_ID')
  const value = await get(`/jobs/single/${id}`)
  if (value === null) throw new CLIError('Job not found', 'NOT_FOUND')
  return stripInvisible(toDetail(value, id))
}
export async function runDetail(input: string, format: Format): Promise<void> {
  const job = await detail(input)
  const output = format === 'json' ? JSON.stringify(job, null, 2) : [
    job.title, `${job.company ?? '—'} · ${job.location ?? (job.isRemote ? 'Remote' : '—')}`,
    `Status: ${job.status ?? 'unknown'}`, `Published: ${job.date ?? 'unknown'}`,
    `Employment: ${job.employmentTypes.join(', ') || 'unknown'}`,
    `Portal expiry: ${job.deadline ?? 'unknown'}`, `Salary: ${job.salary ?? 'unknown'}`,
    '', job.description ?? '(no description)', '', `URL: ${job.url}`, `Apply: ${job.applyUrl ?? `${job.url} (on The Hub)`}`,
  ].join('\n')
  process.stdout.write(output + '\n')
}
