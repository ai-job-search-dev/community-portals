import { describe, expect, test } from 'bun:test'
import fixture from './fixtures/search.json'
import full from './fixtures/detail.json'
import { apiGet, cleanHtml, date, normalizeId, retryAfterMs, toDetail, toResult, USER_AGENT } from '../src/helpers.js'
import { search, searchPath, type SearchOpts } from '../src/commands/search.js'
import { detail } from '../src/commands/detail.js'
import { runCLI } from './helpers.js'

const opts: SearchOpts = { query: 'product', page: 1, limit: 5, sort: 'newest', format: 'json' }

describe('The Hub result normalization', () => {
  test('public search fixture has complete identity and unknown dates', () => {
    const job = toResult(fixture.docs[0])!
    expect(job.title).toBe('Digital Product Designer')
    expect(job.company).toBe('Landfolk')
    expect(job.location).toBe('Aarhus, Denmark')
    expect(job.date).toBeNull()
    expect(job.employmentTypes).toEqual(['Full-time'])
    expect(job.url).toBe(`https://thehub.io/jobs/${job.id}`)
    expect(toResult({ title: 'broken' })).toBeNull()
  })
  test('detail preserves source dates, status, expiry and external apply link', () => {
    const job = toDetail(full, full.id)
    expect(job.date).toBe('2026-10-26')
    expect(job.dateSource).toBe('publishedAt')
    expect(job.deadline).toBe('2026-11-15')
    expect(job.isActive).toBe(true)
    expect(job.applyUrl).toBe('https://jobs.landfolk.com/jobs/8594064')
    expect(toDetail({ ...full, publishedAt: null }, full.id).dateSource).toBe('createdAt')
    expect(toDetail({ ...full, status: 'EXPIRED' }, full.id).isActive).toBe(false)
    expect(toDetail({ ...full, status: null }, full.id).isActive).toBeNull()
    expect(() => toDetail(full, '0'.repeat(24))).toThrow('mismatched')
  })
  test('HTML is readable, numeric entities are safe and dates are valid', () => {
    expect(cleanHtml('<p>R&amp;D &mdash; København</p><ul><li>A &lt; B</li><li>&#x1f680; &#999999999;</li></ul><script>bad()</script>')).toBe('R&D — København\n• A < B\n• 🚀')
    expect(date('2026-02-30')).toBeNull()
    expect(date('not a date')).toBeNull()
  })
  test('a timestamp whose offset crosses midnight UTC is dated, on its UTC day', () => {
    expect(date('2026-01-01T00:30:00+02:00')).toBe('2025-12-31')
    expect(date('2026-10-25T23:30:00-05:00')).toBe('2026-10-26')
    expect(date('2026-10-25')).toBe('2026-10-25')
    expect(date('2026-02-30T10:00:00Z')).toBeNull()
  })
  test('location parts are cleaned like any other source text', () => {
    const job = toResult({ ...fixture.docs[0], location: { locality: 'Aarhus<span hidden> HIDDEN</span>', country: 'Denmark &amp; more' } })!
    expect(job.location).toBe('Aarhus, Denmark & more')
  })
  test('without an employer link, applyUrl is null rather than the listing page', () => {
    expect(toDetail({ ...full, link: null }, full.id).applyUrl).toBeNull()
    expect(toDetail({ ...full, link: 'javascript:alert(1)' }, full.id).applyUrl).toBeNull()
  })
  test('detail IDs cannot redirect lookups to an unrelated host', () => {
    expect(normalizeId(full.id)).toBe(full.id)
    expect(normalizeId(`https://thehub.io/jobs/${full.id}?ref=search`)).toBe(full.id)
    for (const url of [`https://thehub.io.evil.test/jobs/${full.id}`, `https://thehub.io@evil.test/jobs/${full.id}`, `https://evil.test@thehub.io/jobs/${full.id}`, 'https://thehub.io/jobs', '../jobs/test', `ftp://thehub.io/jobs/${full.id}`]) expect(normalizeId(url)).toBeNull()
  })
})

describe('search filters and pagination', () => {
  test('query parameters match the public site and remote has explicit geography', () => {
    const url = new URL(searchPath({ ...opts, query: 'R&D', location: 'Copenhagen', country: 'SE', page: 2 }), 'https://thehub.io')
    expect(url.searchParams.get('search')).toBe('R&D')
    expect(url.searchParams.get('location')).toBe('Copenhagen')
    expect(url.searchParams.get('countryCode')).toBe('SE')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('sorting')).toBe('newJobs')
    expect(searchPath(opts)).toContain('countryCode=DK')
    expect(searchPath({ ...opts, remote: true })).not.toContain('countryCode')
    expect(searchPath({ ...opts, remote: true, country: 'DK' })).toContain('isRemote=true')
  })
  test('deduplicates repeated rows on a page', async () => {
    const output = await search({ ...opts, limit: 10 }, async () => ({ ...fixture, docs: [fixture.docs[0], fixture.docs[0], fixture.docs[1]], total: 3, pages: 1 }))
    expect(output.results.map(j => j.id)).toEqual([fixture.docs[0].id, fixture.docs[1].id])
  })
  test('isolates malformed rows and caps one source page', async () => {
    const output = await search({ ...opts, limit: 1 }, async () => ({ ...fixture, docs: [null, fixture.docs[0], fixture.docs[0], fixture.docs[1]], total: 40, pages: 3 }))
    expect(output.results.length).toBe(1)
    expect(output.meta.malformed).toBe(1)
    expect(output.meta.detailRequests).toBe(0)
    expect(output.meta.nextPage).toBe(2)
    expect(output.meta.total).toBe(40)
  })
  test('empty results are distinct from a changed or broken API', async () => {
    expect((await search(opts, async () => ({ docs: [], total: 0, pages: 0 }))).results).toEqual([])
    for (const invalid of [null, {}, { docs: 'bad' }, { docs: [{}], total: 1, pages: 1 }]) await expect(search(opts, async () => invalid)).rejects.toThrow()
  })
  test('age filtering fetches dates and stops once the output limit is met', async () => {
    const calls: string[] = []
    const result = await search({ ...opts, limit: 1, jobage: 14 }, async path => {
      calls.push(path)
      if (path.startsWith('/v2/')) return fixture
      const id = path.split('/').pop()!
      return { ...full, id, publishedAt: id === fixture.docs[0].id ? '2026-09-01' : '2026-10-25' }
    }, Date.parse('2026-10-26T12:00:00Z'))
    expect(result.results.map(j => j.id)).toEqual([fixture.docs[1].id])
    expect(calls.length).toBe(3)
    expect(result.meta.detailRequests).toBe(2)
  })
  test('unknown dates, closed and removed jobs are counted, never claimed recent', async () => {
    const output = await search({ ...opts, jobage: 14 }, async path => {
      if (path.startsWith('/v2/')) return fixture
      const id = path.split('/').pop()!
      if (id === fixture.docs[0].id) return null
      if (id === fixture.docs[1].id) return { ...full, id, status: 'EXPIRED' }
      return { ...full, id, publishedAt: null, createdAt: null }
    })
    expect(output.results).toEqual([])
    expect(output.meta.unavailable).toBe(2)
    expect(output.meta.missingDates).toBe(1)
  })
  test('404 details and invalid detail responses fail clearly', async () => {
    await expect(detail(full.id, async () => null)).rejects.toThrow('Job not found')
    await expect(detail(full.id, async () => ({}))).rejects.toThrow('invalid')
  })
})

describe('fetch behavior', () => {
  test('uses honest identification and honors Retry-After', async () => {
    let calls = 0
    const sleeps: number[] = []
    const output = await apiGet('/v2/jobs', {
      fetch: async (url, init) => {
        expect(url).toBe('https://thehub.io/api/v2/jobs')
        expect(new Headers(init?.headers).get('user-agent')).toBe(USER_AGENT)
        return ++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : Response.json({ docs: [] })
      }, sleep: async ms => { sleeps.push(ms) }, random: () => 0,
    })
    expect(output).toEqual({ docs: [] }); expect(sleeps).toEqual([2000])
    expect(retryAfterMs('Mon, 26 Oct 2026 12:00:02 GMT', Date.parse('2026-10-26T12:00:00Z'))).toBe(2000)
  })
  test('server errors back off; 404 is null; malformed bodies and permanent errors fail', async () => {
    let calls = 0
    const sleeps: number[] = []
    await apiGet('/v2/jobs', { fetch: async () => ++calls < 3 ? new Response('', { status: 503 }) : Response.json({}), sleep: async ms => { sleeps.push(ms) }, random: () => 0 })
    expect(sleeps).toEqual([500, 1000])
    expect(await apiGet('/jobs/single/test', { fetch: async () => new Response('', { status: 404 }) })).toBeNull()
    await expect(apiGet('/v2/jobs', { fetch: async () => new Response('<html>blocked</html>') })).rejects.toThrow('invalid JSON')
    await expect(apiGet('/v2/jobs', { fetch: async () => new Response('', { status: 403 }) })).rejects.toThrow('403')
    await expect(apiGet('/v2/jobs', { fetch: async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }) })).rejects.toThrow('retry budget')
  })
})

describe('CLI error contract (no network)', () => {
  for (const args of [['detail'], ['detail', 'https://example.com/jobs/123'], ['search', '--bogus'], ['search', '-q'], ['search', '--page', '0'], ['search', '--limit', '1.5'], ['search', '--country', 'XX'], ['search', '--format', 'xml'], ['search', '--sort', 'random'], ['search', '--remote=false'], ['search', 'product'], ['detail', full.id, '--query', 'product']]) {
    test(args.join(' '), async () => {
      const output = await runCLI(args)
      expect(output.exitCode).toBe(1)
      expect(output.stdout).toBe('')
      const error = JSON.parse(output.stderr)
      expect(typeof error.error).toBe('string'); expect(typeof error.code).toBe('string')
    })
  }
  test('help works without a network request', async () => {
    const output = await runCLI(['--help'])
    expect(output.exitCode).toBe(0); expect(output.stdout).toContain('--jobage')
  })
})
