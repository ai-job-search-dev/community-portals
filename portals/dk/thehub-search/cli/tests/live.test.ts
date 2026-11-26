import { expect, test } from 'bun:test'
import { runCLI, parseJSON } from './helpers.js'
import type { JobResult } from '../src/helpers.js'

// Explicit opt-in; CI runs only fixtures and mocks.
test.skipIf(process.env.THEHUB_LIVE_TEST !== '1')('live product search and one detail', async () => {
  const output = parseJSON<{ results: JobResult[] }>(await runCLI(['search', '-q', 'product', '--country', 'DK', '--limit', '3']))
  expect(output.results.length).toBeGreaterThan(0)
  const first = output.results[0]
  expect(first.id).toBeTruthy(); expect(first.title).toBeTruthy(); expect(first.company).toBeTruthy()
  expect(first.url).toMatch(/^https:\/\/thehub\.io\/jobs\/[a-f0-9]{24}$/)
  const job = parseJSON<JobResult & { description: string }>(await runCLI(['detail', first.id]))
  expect(job.id).toBe(first.id); expect(job.description.length).toBeGreaterThan(50)
  expect(job.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})
