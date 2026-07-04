import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAgentBuild } from '@/features/monitor/composables/useAgentBuild'

// Drives the wizard composable against a stubbed fetch. Endpoints exercised:
//   GET  /api/runners                → runner list + default
//   POST /api/custom-agents/generate → { draft }
//   POST /api/custom-agents          → { saved, name }
//   POST /api/jobs                   → { job }
//   GET  /api/jobs/:id               → { job } (poll)
function stubApi(opts: {
  runners?: any
  draft?: any
  saveName?: string | null
  job?: any
  jobStates?: any[]
}) {
  let jobCall = 0
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    if (url.includes('/api/runners')) {
      return { ok: true, status: 200, json: async () => opts.runners ?? { runners: [], defaultRunnerId: null } }
    }
    if (url.includes('/api/custom-agents/generate') && method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ draft: opts.draft }) }
    }
    if (url.includes('/api/custom-agents') && method === 'POST') {
      if (opts.saveName === null) return { ok: false, status: 400, json: async () => ({ error: 'bad name' }) }
      return { ok: true, status: 200, json: async () => ({ saved: true, name: opts.saveName ?? 'agent-x' }) }
    }
    if (url.includes('/api/jobs') && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ job: opts.job ?? { id: 'job1', status: 'queued' } }) }
    }
    if (url.includes('/api/jobs/')) {
      const states = opts.jobStates ?? [{ id: 'job1', status: 'succeeded' }]
      const job = states[Math.min(jobCall, states.length - 1)]
      jobCall += 1
      return { ok: true, status: 200, json: async () => ({ job }) }
    }
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function make(overrides: any = {}) {
  return useAgentBuild({
    getProjectId: () => null,
    getWorkspace: () => 'custom-agents',
    pollMs: 1,
    maxWaitMs: 200,
    ...overrides,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useAgentBuild', () => {
  it('loadRunners selects the usable default runner', async () => {
    stubApi({
      runners: {
        defaultRunnerId: 'r2',
        runners: [
          { id: 'r1', name: 'A', enabled: false },
          { id: 'r2', name: 'B' },
        ],
      },
    })
    const b = make()
    await b.loadRunners()

    expect(b.usableRunners.value.map((r) => r.id)).toEqual(['r2'])
    expect(b.hasUsableRunner.value).toBe(true)
    expect(b.selectedRunnerId.value).toBe('r2')
  })

  it('reports no usable runner when all are disabled', async () => {
    stubApi({ runners: { defaultRunnerId: null, runners: [{ id: 'r1', name: 'A', enabled: false }] } })
    const b = make()
    await b.loadRunners()

    expect(b.hasUsableRunner.value).toBe(false)
    expect(b.selectedRunnerId.value).toBeNull()
  })

  it('generate advances to preview and stores the draft', async () => {
    stubApi({ draft: { name: 'gen-agent', skills: ['s1'] } })
    const b = make()
    b.description.value = 'agent làm gì đó'
    await b.generate()

    expect(b.step.value).toBe('preview')
    expect(b.draft.value?.name).toBe('gen-agent')
  })

  it('generate refuses an empty description', async () => {
    stubApi({})
    const b = make()
    await b.generate()

    expect(b.step.value).toBe('describe')
    expect(b.error.value).toContain('mô tả')
  })

  it('buildAndRun saves, submits, polls to success', async () => {
    stubApi({
      runners: { defaultRunnerId: 'r1', runners: [{ id: 'r1', name: 'A' }] },
      saveName: 'built-agent',
      job: { id: 'jobZ', status: 'queued' },
      jobStates: [{ id: 'jobZ', status: 'running' }, { id: 'jobZ', status: 'succeeded' }],
    })
    const b = make()
    await b.loadRunners()
    b.draft.value = { name: 'built-agent', description: '' }
    await b.buildAndRun()

    expect(b.step.value).toBe('run')
    expect(b.savedName.value).toBe('built-agent')
    expect(b.jobId.value).toBe('jobZ')
    expect(b.jobStatus.value).toBe('succeeded')
    expect(b.jobError.value).toBeNull()
  })

  it('buildAndRun surfaces a failed job without throwing', async () => {
    stubApi({
      runners: { defaultRunnerId: 'r1', runners: [{ id: 'r1', name: 'A' }] },
      saveName: 'built-agent',
      job: { id: 'jobF', status: 'queued' },
      jobStates: [{ id: 'jobF', status: 'failed', error: 'runner disabled' }],
    })
    const b = make()
    await b.loadRunners()
    b.draft.value = { name: 'built-agent', description: '' }
    await b.buildAndRun()

    expect(b.jobError.value).toContain('runner disabled')
  })

  it('buildAndRun blocks when no usable runner is configured', async () => {
    stubApi({ runners: { defaultRunnerId: null, runners: [] } })
    const b = make()
    await b.loadRunners()
    b.draft.value = { name: 'built-agent', description: '' }
    await b.buildAndRun()

    expect(b.error.value).toContain('runner khả dụng')
    // Should not have started a run/job.
    expect(b.jobId.value).toBeNull()
  })

  it('buildAndRun requires a draft name', async () => {
    stubApi({ runners: { defaultRunnerId: 'r1', runners: [{ id: 'r1', name: 'A' }] } })
    const b = make()
    await b.loadRunners()
    b.draft.value = { name: '  ', description: '' }
    await b.buildAndRun()

    expect(b.error.value).toContain('tên')
    expect(b.jobId.value).toBeNull()
  })

  it('reset returns to the initial state', async () => {
    stubApi({ draft: { name: 'gen' } })
    const b = make()
    b.description.value = 'x'
    await b.generate()
    b.reset()

    expect(b.step.value).toBe('describe')
    expect(b.description.value).toBe('')
    expect(b.draft.value).toBeNull()
  })
})
