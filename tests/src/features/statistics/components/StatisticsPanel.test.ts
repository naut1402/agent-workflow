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
    minTotalTokens: totalTokens,
    maxTotalTokens: totalTokens,
    avgTotalTokens: totalTokens,
    minDurationMs: 1000,
    maxDurationMs: 1000,
    avgDurationMs: 1000,
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

function urlsContain(fragment: string): boolean {
  return fetchMock.mock.calls.some(([url]) => String(url).includes(fragment))
}

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  localStorage.clear()
})

describe('StatisticsPanel — đa chart', () => {
  it('mount mặc định 1 chart theo task → bảng có cột min/max/avg tokens + duration', async () => {
    mockStats(statsBody(['TB1', 'TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    expect(lastUrl()).toContain('/api/statistics/usage')
    const q = urlQuery(lastUrl())
    expect(q.get('project')).toBe('p1')
    expect(q.get('groupBy')).toBe('task')
    expect(q.get('from')).toBeTruthy()

    expect(wrapper.findAll('.statistics-chart-item')).toHaveLength(1)
    expect(wrapper.findAll('.statistics-table thead th').map((th) => th.text())).toContain(
      'Avg tok/entry',
    )
    expect(wrapper.find('.statistics-summary').text()).toContain('200')
  })

  it('drill: click row task → refetch groupBy=step, breadcrumb xoá drill quay về task', async () => {
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

    fetchMock.mockClear()
    await wrapper.find('.statistics-crumb').trigger('click')
    await flushPromises()
    const q2 = urlQuery(lastUrl())
    expect(q2.get('task')).toBe(null)
    expect(q2.get('groupBy')).toBe('task')
  })

  it('thêm chart → 2 chart + dialog mở sẵn; đổi groupBy trong dialog → fetch thêm groupBy mới; xoá chart', async () => {
    mockStats(statsBody(['TB1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    await wrapper.find('.statistics-add-chart').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.statistics-chart-item')).toHaveLength(2)
    // Dialog mở sẵn cho chart mới.
    const dialog = wrapper.findComponent({ name: 'ChartSettingsDialog' })
    expect(dialog.exists()).toBe(true)

    // Đổi groupBy của chart mới sang Model (selectbox thứ nhất trong dialog).
    await dialog.findAll('.c-select-trigger')[0].trigger('click')
    const modelOption = wrapper.findAll('.c-select-option').find((o) => o.text() === 'Model')
    expect(modelOption).toBeTruthy()
    await modelOption!.trigger('click')
    await flushPromises()

    expect(urlsContain('groupBy=model')).toBe(true)
    expect(urlsContain('groupBy=task')).toBe(true)

    // Persist cấu trúc đa chart.
    const saved = JSON.parse(localStorage.getItem('dev-dashboard-statistics-prefs')!)
    expect(saved.charts).toHaveLength(2)
    expect(saved.charts[1].groupBy).toBe('model')

    // Xoá chart đầu → còn 1, không còn nút xoá.
    await wrapper.findAll('.statistics-chart-item .icon-btn')[1].trigger('click') // nút xoá của chart 1
    await flushPromises()
    expect(wrapper.findAll('.statistics-chart-item')).toHaveLength(1)
  })

  it('gear mở dialog settings — sửa title áp live + persist', async () => {
    mockStats(statsBody(['TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    await wrapper.find('.statistics-chart-item .icon-btn').trigger('click') // gear
    const dialog = wrapper.findComponent({ name: 'ChartSettingsDialog' })
    expect(dialog.exists()).toBe(true)

    await dialog.find('input[type="text"]').setValue('Tiêu đề tùy chỉnh')
    await flushPromises()

    const saved = JSON.parse(localStorage.getItem('dev-dashboard-statistics-prefs')!)
    expect(saved.charts[0].title).toBe('Tiêu đề tùy chỉnh')

    const card = wrapper.findComponent({ name: 'ChartCard' })
    expect(card.props('title')).toBe('Tiêu đề tùy chỉnh')

    await dialog.find('.chart-settings-close').trigger('click')
    expect(wrapper.findComponent({ name: 'ChartSettingsDialog' }).exists()).toBe(false)
  })

  it('resize event từ ChartCard → cập nhật style chart và persist', async () => {
    mockStats(statsBody(['TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    const card = wrapper.findComponent({ name: 'ChartCard' })
    card.vm.$emit('resize', 880, 420)
    await flushPromises()

    const saved = JSON.parse(localStorage.getItem('dev-dashboard-statistics-prefs')!)
    expect(saved.charts[0].style.width).toBe(880)
    expect(saved.charts[0].style.height).toBe(420)
  })

  it('prefs bản đơn chart cũ migrate thành danh sách 1 phần tử', async () => {
    localStorage.setItem(
      'dev-dashboard-statistics-prefs',
      JSON.stringify({
        scope: 'project',
        rangeDays: 90,
        groupBy: 'model',
        metric: 'inputTokens',
        chartType: 'line',
        chart: { width: 900, height: 400 },
      }),
    )
    mockStats(statsBody(['m1'], 'model'))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    const q = urlQuery(lastUrl())
    expect(q.get('groupBy')).toBe('model')
    const card = wrapper.findComponent({ name: 'ChartCard' })
    expect(card.props('chartType')).toBe('line')
    expect(card.props('styleConfig').width).toBe(900)
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
})
