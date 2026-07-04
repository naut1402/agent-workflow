import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAndRunAgent } from '../../../src/api/client'

// Stub fetch so we can assert the compose order (save custom agent → submit job)
// and the derived job payload without a live server.
function stubApi(saveRes: any, jobRes: any) {
  const calls: Array<{ url: string; method: string; body: any }> = []
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url, method, body })
    if (url.includes('/api/custom-agents') && method === 'POST') {
      if (saveRes === null) return { ok: false, status: 400, json: async () => ({ error: 'bad name' }) }
      return { ok: true, status: 200, json: async () => saveRes }
    }
    if (url.includes('/api/jobs') && method === 'POST') {
      return { ok: true, status: 201, json: async () => jobRes }
    }
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('buildAndRunAgent', () => {
  it('saves the agent then submits a job with agentRef dashboard:<name>', async () => {
    const { calls } = stubApi({ saved: true, name: 'code-reviewer' }, { job: { id: 'job1', status: 'queued' } })

    const res = await buildAndRunAgent({
      draft: { name: 'Code Reviewer' },
      userPrompt: 'smoke',
      workspace: 'tasks/T1',
      runnerId: 'r1',
      projectId: 'proj-b',
    })

    expect(res.name).toBe('code-reviewer')
    expect(res.job).toEqual({ id: 'job1', status: 'queued' })

    // Save runs before submit.
    expect(calls[0].url).toContain('/api/custom-agents')
    expect(calls[1].url).toContain('/api/jobs')

    expect(calls[0].url).toContain('project=proj-b')
    expect(calls[1].url).toContain('project=proj-b')

    const jobBody = calls[1].body
    expect(jobBody.agentRef).toBe('dashboard:code-reviewer')
    expect(jobBody.workspace).toBe('tasks/T1')
    expect(jobBody.userPrompt).toBe('smoke')
    expect(jobBody.runnerId).toBe('r1')
    expect(jobBody.metadata.projectId).toBe('proj-b')
  })

  it('does not submit a job when saving fails', async () => {
    const { calls } = stubApi(null, { job: { id: 'x' } })

    await expect(
      buildAndRunAgent({ draft: { name: 'X' }, userPrompt: 's', workspace: 'custom-agents' }),
    ).rejects.toThrow()

    // Only the save call was attempted; the job submit never ran.
    expect(calls.some((c) => c.url.includes('/api/jobs'))).toBe(false)
  })

  it('throws a clear message when the save response omits the name', async () => {
    stubApi({ saved: true }, { job: { id: 'x' } })

    await expect(
      buildAndRunAgent({ draft: { name: 'X' }, userPrompt: 's', workspace: 'custom-agents' }),
    ).rejects.toThrow(/tên/)
  })

  it('omits projectId from metadata when not provided', async () => {
    const { calls } = stubApi({ saved: true, name: 'a' }, { job: { id: 'j' } })

    await buildAndRunAgent({ draft: { name: 'a' }, userPrompt: 's', workspace: 'custom-agents' })

    expect(calls[0].url).not.toContain('project=')
    expect(calls[1].url).not.toContain('project=')
    expect(calls[1].body.metadata).toEqual({})
  })
})
