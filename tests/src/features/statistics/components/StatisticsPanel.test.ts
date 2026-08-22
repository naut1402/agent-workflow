import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import StatisticsPanel from '@/features/statistics/components/StatisticsPanel.vue'
import { mountWithI18n } from '../../../helpers/i18n'

// Panel không vẽ mermaid thật trong jsdom — ChartCard đã có test wiring riêng.
vi.mock('@/core/lib/markdownLib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/lib/markdownLib')>()
  return {
    ...actual,
    renderMermaid: vi.fn(async () => {}),
  }
})

function usageGroup(key: string, totalTokens: number) {
  return {
    key,
    entries: 1,
    jobs: 1,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
    durationMs: 1000,
    firstTs: 1_785_000_000_000,
    lastTs: 1_785_000_000_000,
  }
}

function statsBody(keys: string[], groupBy = 'task') {
  return {
    groupBy,
    groups: keys.map((k, i) => usageGroup(k, 100 * (keys.length - i))),
    truncated: false,
    totals: {
      entries: keys.length,
      jobs: keys.length,
      inputTokens: 10 * keys.length,
      outputTokens: 5 * keys.length,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 100 * keys.length,
      durationMs: 1000 * keys.length,
      firstTs: 1_785_000_000_000,
      lastTs: 1_785_000_000_000,
    },
  }
}

const fetchMock = vi.fn()

/** Response mới mỗi call — body Response chỉ đọc được một lần. */
function mockStats(body: unknown, status = 200) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }))
}

function lastUrl(): string {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]
}

function urlQuery(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1))
}

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  localStorage.clear()
})

describe('StatisticsPanel', () => {
  it('mount → gọi /api/statistics/usage với project + groupBy mặc định, render bảng', async () => {
    mockStats(statsBody(['TB1', 'TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    expect(lastUrl()).toContain('/api/statistics/usage')
    const q = urlQuery(lastUrl())
    expect(q.get('project')).toBe('p1')
    expect(q.get('groupBy')).toBe('task')
    // range mặc định 30 ngày → có param from.
    expect(q.get('from')).toBeTruthy()

    expect(wrapper.findAll('.statistics-table tbody tr')).toHaveLength(2)
    expect(wrapper.find('.statistics-summary').text()).toContain('200')
  })

  it('drill: click row task → gọi lại với task=<key>&groupBy=step, hiện breadcrumb', async () => {
    mockStats(statsBody(['TB1', 'TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()
    fetchMock.mockClear()

    await wrapper.findAll('.statistics-table tbody tr')[0].trigger('click')
    await flushPromises()

    const q = urlQuery(lastUrl())
    expect(q.get('task')).toBe('TB1')
    expect(q.get('groupBy')).toBe('step')
    expect(wrapper.find('.statistics-crumb').text()).toContain('TB1')

    // Breadcrumb click → xoá drill, quay về groupBy task.
    fetchMock.mockClear()
    await wrapper.find('.statistics-crumb').trigger('click')
    await flushPromises()
    const q2 = urlQuery(lastUrl())
    expect(q2.get('task')).toBe(null)
    expect(q2.get('groupBy')).toBe('task')
  })

  it('scope all + groupBy project: click project row → drill project, groupBy task', async () => {
    mockStats(statsBody(['p2', 'p1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: null } })
    await flushPromises()

    // CSelect đầu (scope) → chọn "Tất cả project".
    await wrapper.findAll('.statistics-field .c-select-trigger')[0].trigger('click')
    const allOption = wrapper
      .findAll('.c-select-option')
      .find((o) => o.text().includes('Tất cả project'))
    expect(allOption).toBeTruthy()
    await allOption!.trigger('click')
    await flushPromises()

    // CSelect thứ hai (groupBy) → chọn "Project".
    await wrapper.findAll('.statistics-field .c-select-trigger')[1].trigger('click')
    const projectOption = wrapper
      .findAll('.c-select-option')
      .find((o) => o.text() === 'Project')
    expect(projectOption).toBeTruthy()
    await projectOption!.trigger('click')
    await flushPromises()

    const q = urlQuery(lastUrl())
    expect(q.get('project')).toBe(null) // scope all → không lọc project
    expect(q.get('groupBy')).toBe('project')

    fetchMock.mockClear()
    await wrapper.findAll('.statistics-table tbody tr')[0].trigger('click')
    await flushPromises()
    const q2 = urlQuery(lastUrl())
    expect(q2.get('project')).toBe('p2')
    expect(q2.get('groupBy')).toBe('task')
  })

  it('prefs persist qua localStorage và load lại ở lần mount sau', async () => {
    mockStats(statsBody(['TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const first = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()
    // Đổi range sang "Tất cả" (0).
    const allRangeBtn = first.findAll('.statistics-range-btn').at(-1)!
    await allRangeBtn.trigger('click')
    await flushPromises()

    const saved = JSON.parse(localStorage.getItem('dev-dashboard-statistics-prefs')!)
    expect(saved.rangeDays).toBe(0)
    first.unmount()

    fetchMock.mockClear()
    mockStats(statsBody(['TA1']))
    mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()
    expect(urlQuery(lastUrl()).get('from')).toBe(null) // range all → không from
  })

  it('API lỗi → err-banner, bảng trống không crash', async () => {
    mockStats({ error: 'boom' }, 500)
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()
    expect(wrapper.find('.err-banner').exists()).toBe(true)
    expect(wrapper.findAll('.statistics-table tbody tr')).toHaveLength(0)
  })

  it('response 200 sai shape → err-banner (validate biên I/O)', async () => {
    mockStats({ something: 'off' })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()
    expect(wrapper.find('.err-banner').exists()).toBe(true)
    expect(wrapper.find('.statistics-summary').exists()).toBe(false)
  })

  it('gear mở dialog settings — sửa title áp live + persist vào localStorage', async () => {
    mockStats(statsBody(['TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    await wrapper.find('.statistics-settings-btn').trigger('click')
    const dialog = wrapper.findComponent({ name: 'ChartSettingsDialog' })
    expect(dialog.exists()).toBe(true)

    await dialog.find('input[type="text"]').setValue('Tiêu đề tùy chỉnh')
    await flushPromises()

    const saved = JSON.parse(localStorage.getItem('dev-dashboard-statistics-prefs')!)
    expect(saved.chart.titleOverride).toBe('Tiêu đề tùy chỉnh')

    // Live-apply: ChartCard nhận styleConfig mới qua prop.
    const card = wrapper.findComponent({ name: 'ChartCard' })
    expect(card.props('styleConfig')?.titleOverride).toBe('Tiêu đề tùy chỉnh')

    await dialog.find('.chart-settings-close').trigger('click')
    expect(wrapper.findComponent({ name: 'ChartSettingsDialog' }).exists()).toBe(false)
  })

  it('resize event từ ChartCard → cập nhật prefs.chart và persist', async () => {
    mockStats(statsBody(['TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    const card = wrapper.findComponent({ name: 'ChartCard' })
    card.vm.$emit('resize', 880, 420)
    await flushPromises()

    const saved = JSON.parse(localStorage.getItem('dev-dashboard-statistics-prefs')!)
    expect(saved.chart.width).toBe(880)
    expect(saved.chart.height).toBe(420)
    expect(card.props('styleConfig')?.width).toBe(880)
  })
})
