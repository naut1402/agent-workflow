import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import LogsPanel from '@/features/logs/components/LogsPanel.vue'
import { mountWithI18n } from '../../../helpers/i18n'

vi.mock('@/features/settings/scripts/SettingsDialogApi', () => ({
  fetchLoggingConfig: vi.fn(async () => ({
    config: {
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: true, usage: true },
    },
  })),
}))

import { fetchLoggingConfig } from '@/features/settings/scripts/SettingsDialogApi'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(fetchLoggingConfig).mockReset()
  vi.mocked(fetchLoggingConfig).mockResolvedValue({
    config: {
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: true, usage: true },
    },
  })
  // JobLogDialog renders via <Teleport to="body"> — clear leftover nodes between tests.
  document.body.innerHTML = ''
})

const JOB_ID = '11111111-2222-4333-8444-555555555555'
const JOB_ID_2 = '22222222-3333-4444-8555-666666666666'

function stubFetch() {
  const mock = vi.fn(async (url: string) => {
    let body: any = {}
    if (url.includes(`/api/jobs/${JOB_ID_2}`)) body = { id: JOB_ID_2, text: 'log của job B', truncated: false }
    else if (url.includes('/api/jobs/')) body = { id: JOB_ID, text: 'hello job log', truncated: false }
    else if (url.includes('/api/jobs'))
      body = {
        jobs: [
          {
            id: JOB_ID,
            status: 'succeeded',
            createdAt: '2026-01-01T00:00:00.000Z',
            agentRef: 'project/quick-action-improve-doc',
            metadata: { artifactName: 'design.md', pipelineStepId: 'implementer' },
          },
          {
            id: JOB_ID_2,
            status: 'running',
            createdAt: '2026-01-02T00:00:00.000Z',
            agentRef: 'project/quick-action-review',
            metadata: { artifactName: 'review.md', pipelineStepId: 'reviewer' },
          },
        ],
      }
    else if (url.includes('/api/logs')) {
      const events = url.includes('type=events')
      const usage = url.includes('type=usage')
      body = {
        entries: events
          ? [
              {
                type: 'events',
                iso: '2026-01-02',
                level: 'info',
                traceId: 'trace-evt',
                event: 'job.started',
                payload: { id: 'j1' },
                projectId: 'p1',
              },
            ]
          : usage
            ? [
                {
                  type: 'usage',
                  iso: '2026-01-03',
                  level: 'info',
                  traceId: '',
                  jobId: JOB_ID,
                  inputTokens: 10,
                  outputTokens: 20,
                  cacheReadTokens: 5,
                  cacheWriteTokens: 2,
                  totalTokens: 37,
                  estimatedCostUsd: null,
                  model: 'claude-sonnet',
                  provider: 'claude-code-cli',
                  taskId: 'T20fd4281',
                  stepId: 'implementer',
                  projectId: 'p1',
                },
              ]
            : [
                {
                  type: 'audit',
                  iso: '2026-01-01',
                  level: 'info',
                  traceId: 'trace-demo',
                  op: 'create',
                  entity: 'custom-agent',
                  identifier: 'foo',
                  projectId: null,
                },
              ],
      }
    }
    return { ok: true, json: async () => body }
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('LogsPanel', () => {
  it('mounts and loads the audit log by default', async () => {
    const fetchMock = stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()

    expect(w.find('.logs-panel').exists()).toBe(true)
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/logs') && u.includes('type=audit'))).toBe(true)
    expect(w.find('.logs-table').text()).toContain('custom-agent')
  })

  it('switching to the request tab fetches request logs', async () => {
    const fetchMock = stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()

    await w.findAll('.logs-tabs button')[1].trigger('click') // "Yêu cầu"
    await flushPromises()

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/logs') && u.includes('type=request'))).toBe(true)
  })

  it('jobs tab lists jobs in a table, each row with a "view log" button', async () => {
    const fetchMock = stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()

    await w.findAll('.logs-tabs button')[4].trigger('click') // "Jobs" (events+usage on → index 4)
    await flushPromises()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/jobs'))).toBe(true)

    const rows = w.findAll('.logs-table-jobs tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('project/quick-action-improve-doc')
    expect(rows[0].text()).toContain('implementer')
    expect(rows[0].find('button').exists()).toBe(true)
    // No tail/live-follow control anywhere on the tab (TC-14 regression).
    expect(w.text()).not.toContain('Tail')
  })

  it('clicking the view-log button opens a dialog with that exact job\'s log, and closing it works', async () => {
    stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()
    await w.findAll('.logs-tabs button')[4].trigger('click')
    await flushPromises()

    const rows = w.findAll('.logs-table-jobs tbody tr')
    await rows[0].find('button').trigger('click')
    await flushPromises()
    // JobLogDialog renders via <Teleport to="body"> — query document.body, not the wrapper.
    expect(document.body.querySelector('.modal')).not.toBeNull()
    expect(document.body.querySelector('.modal .job-log-section-body')?.textContent).toContain('hello job log')

    ;(document.body.querySelector('.modal-close') as HTMLElement)?.click()
    await flushPromises()
    expect(document.body.querySelector('.modal')).toBeNull()

    // Click the second row's button — must show job B's log, not job A's leftover.
    await rows[1].find('button').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.modal .job-log-section-body')?.textContent).toContain('log của job B')
    expect(document.body.querySelector('.modal .job-log-section-body')?.textContent).not.toContain('hello job log')
  })

  it('opening the dialog for a running job does not throw even with a partial log', async () => {
    stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()
    await w.findAll('.logs-tabs button')[4].trigger('click')
    await flushPromises()

    const rows = w.findAll('.logs-table-jobs tbody tr')
    await rows[1].find('button').trigger('click') // job B is 'running'
    await flushPromises()
    expect(document.body.querySelector('.modal')).not.toBeNull()
    expect(document.body.querySelector('.modal .job-log-section-body')?.textContent).toContain('log của job B')
  })

  it('shows an empty state, consistent with other tabs, when there are no jobs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/jobs')) return { ok: true, json: async () => ({ jobs: [] }) }
        return { ok: true, json: async () => ({ entries: [] }) }
      }),
    )
    const w = mountWithI18n(LogsPanel)
    await flushPromises()
    await w.findAll('.logs-tabs button')[4].trigger('click')
    await flushPromises()

    expect(w.findAll('.logs-table-jobs tbody tr')).toHaveLength(1)
    expect(w.find('.logs-table-jobs').text()).toContain('Chưa có job')
  })

  it('events tab fetches domain event logs (default on)', async () => {
    const fetchMock = stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()

    const labels = w.findAll('.logs-tabs button').map((b) => b.text())
    expect(labels).toEqual(['Kiểm toán', 'Yêu cầu', 'Events', 'Usage', 'Jobs'])

    await w.findAll('.logs-tabs button')[2].trigger('click') // Events
    await flushPromises()

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/logs') && u.includes('type=events'))).toBe(true)
    expect(w.find('.logs-table-events').text()).toContain('job.started')
  })

  it('usage tab fetches usage logs and shows token columns', async () => {
    const fetchMock = stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()

    await w.findAll('.logs-tabs button')[3].trigger('click') // Usage
    await flushPromises()

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/logs') && u.includes('type=usage'))).toBe(true)
    const table = w.find('.logs-table-usage')
    expect(table.text()).toContain('claude-sonnet')
    expect(table.text()).toContain('37')
    expect(table.text()).toContain('Cache read')
    expect(table.text()).toContain('Cache write')
    expect(table.text()).toContain('T20fd4281')
    expect(table.text()).toContain('Step')
    expect(table.text()).toContain('implementer')
  })

  it('hides events tab when events prefs off', async () => {
    vi.mocked(fetchLoggingConfig).mockResolvedValue({
      config: {
        showLogsTab: true,
        types: { audit: true, request: true, jobs: true, events: false, usage: true },
      },
    })
    stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()
    const labels = w.findAll('.logs-tabs button').map((b) => b.text())
    expect(labels).toEqual(['Kiểm toán', 'Yêu cầu', 'Usage', 'Jobs'])
  })

  it('hides usage tab when usage prefs off', async () => {
    vi.mocked(fetchLoggingConfig).mockResolvedValue({
      config: {
        showLogsTab: true,
        types: { audit: true, request: true, jobs: true, events: false, usage: false },
      },
    })
    stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()
    const labels = w.findAll('.logs-tabs button').map((b) => b.text())
    expect(labels).toEqual(['Kiểm toán', 'Yêu cầu', 'Jobs'])
  })

  it('hides request/jobs tabs when logging types disabled', async () => {
    vi.mocked(fetchLoggingConfig).mockResolvedValue({
      config: {
        showLogsTab: true,
        types: { audit: true, request: false, jobs: false, events: false, usage: false },
      },
    })
    stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()

    const labels = w.findAll('.logs-tabs button').map((b) => b.text())
    expect(labels).toEqual(['Kiểm toán'])
    expect(w.find('.logs-table').exists()).toBe(true)
  })

  it('shows allDisabled empty when every log type is off', async () => {
    vi.mocked(fetchLoggingConfig).mockResolvedValue({
      config: {
        showLogsTab: true,
        types: { audit: false, request: false, jobs: false, events: false, usage: false },
      },
    })
    stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()

    expect(w.find('.logs-tabs').exists()).toBe(false)
    expect(w.text()).toContain('Mọi loại log đang tắt')
  })

  it('reacts to logging-changed event by updating visible tabs', async () => {
    stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()
    expect(w.findAll('.logs-tabs button')).toHaveLength(5)

    window.dispatchEvent(
      new CustomEvent('dev-dashboard:logging-changed', {
        detail: { types: { audit: false, request: true, jobs: false, events: false, usage: false } },
      }),
    )
    await flushPromises()

    const labels = w.findAll('.logs-tabs button').map((b) => b.text())
    expect(labels).toEqual(['Yêu cầu'])
  })
})
