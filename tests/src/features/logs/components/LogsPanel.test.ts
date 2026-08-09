import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import LogsPanel from '@/features/logs/components/LogsPanel.vue'
import { mountWithI18n } from '../../../helpers/i18n'

vi.mock('@/features/settings/scripts/SettingsDialogApi', () => ({
  fetchLoggingConfig: vi.fn(async () => ({
    config: {
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: true },
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
      types: { audit: true, request: true, jobs: true, events: true },
    },
  })
})

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
    else if (url.includes('/api/logs')) {
      const events = url.includes('type=events')
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

  it('jobs tab lists jobs and shows the selected job log', async () => {
    const fetchMock = stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()

    await w.findAll('.logs-tabs button')[3].trigger('click') // "Jobs" (events on → index 3)
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

  it('events tab fetches domain event logs (default on)', async () => {
    const fetchMock = stubFetch()
    const w = mountWithI18n(LogsPanel)
    await flushPromises()

    const labels = w.findAll('.logs-tabs button').map((b) => b.text())
    expect(labels).toEqual(['Kiểm toán', 'Yêu cầu', 'Events', 'Jobs'])

    await w.findAll('.logs-tabs button')[2].trigger('click') // Events
    await flushPromises()

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/logs') && u.includes('type=events'))).toBe(true)
    expect(w.find('.logs-table-events').text()).toContain('job.started')
  })

  it('hides events tab when events prefs off', async () => {
    vi.mocked(fetchLoggingConfig).mockResolvedValue({
      config: {
        showLogsTab: true,
        types: { audit: true, request: true, jobs: true, events: false },
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
        types: { audit: true, request: false, jobs: false, events: false },
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
        types: { audit: false, request: false, jobs: false, events: false },
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
    expect(w.findAll('.logs-tabs button')).toHaveLength(4)

    window.dispatchEvent(
      new CustomEvent('dev-dashboard:logging-changed', {
        detail: { types: { audit: false, request: true, jobs: false, events: false } },
      }),
    )
    await flushPromises()

    const labels = w.findAll('.logs-tabs button').map((b) => b.text())
    expect(labels).toEqual(['Yêu cầu'])
  })
})
