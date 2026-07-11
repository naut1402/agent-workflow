import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import LogsPanel from '@/features/logs/components/LogsPanel.vue'

afterEach(() => vi.unstubAllGlobals())

const JOB_ID = '11111111-2222-4333-8444-555555555555'

function stubFetch() {
  const mock = vi.fn(async (url: string) => {
    let body: any = {}
    if (url.includes('/api/jobs/')) body = { id: JOB_ID, text: 'hello job log', truncated: false }
    else if (url.includes('/api/jobs'))
      body = {
        jobs: [
          {
            id: JOB_ID,
            status: 'succeeded',
            agentRef: 'project/quick-action-improve-doc',
            metadata: { artifactName: 'design.md' },
          },
        ],
      }
    else if (url.includes('/api/logs'))
      body = { entries: [{ type: 'audit', iso: '2026-01-01', op: 'create', entity: 'custom-agent', identifier: 'foo', projectId: null }] }
    return { ok: true, json: async () => body }
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('LogsPanel', () => {
  it('mounts and loads the audit log by default', async () => {
    const fetchMock = stubFetch()
    const w = mount(LogsPanel)
    await flushPromises()

    expect(w.find('.logs-panel').exists()).toBe(true)
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/logs') && u.includes('type=audit'))).toBe(true)
    expect(w.find('.logs-table').text()).toContain('custom-agent')
  })

  it('switching to the request tab fetches request logs', async () => {
    const fetchMock = stubFetch()
    const w = mount(LogsPanel)
    await flushPromises()

    await w.findAll('.logs-tabs button')[1].trigger('click') // "Yêu cầu"
    await flushPromises()

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/logs') && u.includes('type=request'))).toBe(true)
  })

  it('jobs tab lists jobs and shows the selected job log', async () => {
    const fetchMock = stubFetch()
    const w = mount(LogsPanel)
    await flushPromises()

    await w.findAll('.logs-tabs button')[2].trigger('click') // "Jobs"
    await flushPromises()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/jobs'))).toBe(true)

    // List item shows agent + artifact context, not just the raw job id.
    const item = w.find('.jobs-list li')
    expect(item.text()).toContain('project/quick-action-improve-doc')
    expect(item.text()).toContain('design.md')

    await item.trigger('click')
    await flushPromises()
    expect(w.find('.job-log pre').text()).toContain('hello job log')
  })
})
