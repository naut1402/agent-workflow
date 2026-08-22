import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import StatisticsPanel from '@/features/statistics/components/StatisticsPanel.vue'
import { mountWithI18n } from '../../../helpers/i18n'

// Panel mount ChartCard → chart.js cần canvas 2d (jsdom không có) — mock chart.js/auto.
vi.mock('chart.js/auto', () => ({
  default: class FakeChart {
    constructor(_canvas: unknown, _config: unknown) {}
    destroy() {}
    update() {}
  },
}))

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
      totalTokens: 25_000,
      durationMs: 1000 * keys.length,
      firstTs: 1_785_000_000_000,
      lastTs: 1_785_000_000_000,
      minTotalTokens: 100,
      maxTotalTokens: 500,
      avgTotalTokens: 250,
      minDurationMs: 1000,
      maxDurationMs: 3000,
      avgDurationMs: 2000,
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

describe('StatisticsPanel — gallery đa chart + summary card', () => {
  it('mount mặc định 1 chart theo task → summary card có min/max/avg, bảng KHÔNG còn cột stats', async () => {
    mockStats(statsBody(['TB1', 'TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    const q = urlQuery(lastUrl())
    expect(q.get('project')).toBe('p1')
    expect(q.get('groupBy')).toBe('task')
    expect(q.get('from')).toBeTruthy()

    expect(wrapper.findAll('.chart-tile')).toHaveLength(1)
    // Card summary hiển thị mốc per-entry.
    const summary = wrapper.find('.statistics-summary-card')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('250')
    expect(summary.text()).toContain('500')
    // Bảng không còn cột min/max/avg (đã dời vào card).
    const headers = wrapper.findAll('.statistics-table thead th').map((th) => th.text())
    expect(headers).not.toContain('Min thời lượng')
    expect(headers).toContain('Total')
  })

  it('định dạng số theo chart: compact "25.0K" → full "25,000" qua dialog settings', async () => {
    mockStats(statsBody(['TB1', 'TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()
    expect(wrapper.find('.statistics-summary-card').text()).toContain('25.00K')

    // Mở dialog, chọn numberFormat "Đầy đủ" (CSelect thứ 4 trong dialog).
    await wrapper.find('.chart-tile .chart-tile-actions .icon-btn').trigger('click')
    const dialog = wrapper.findComponent({ name: 'ChartSettingsDialog' })
    expect(dialog.exists()).toBe(true)
    await dialog.findAll('.c-select-trigger')[3].trigger('click')
    const fullOption = wrapper.findAll('.c-select-option').find((o) => o.text() === 'Đầy đủ (1,234,567)')
    expect(fullOption).toBeTruthy()
    await fullOption!.trigger('click')
    await flushPromises()

    expect(wrapper.find('.statistics-summary-card').text()).toContain('25,000')
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

  it('thêm chart → 2 tile + dialog mở sẵn; đổi groupBy → fetch thêm groupBy mới; xoá chart', async () => {
    mockStats(statsBody(['TB1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    await wrapper.find('.statistics-add-chart').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.chart-tile')).toHaveLength(2)
    const dialog = wrapper.findComponent({ name: 'ChartSettingsDialog' })
    expect(dialog.exists()).toBe(true)

    // Đổi groupBy của chart mới sang Model (CSelect thứ nhất trong dialog).
    await dialog.findAll('.c-select-trigger')[0].trigger('click')
    const modelOption = wrapper.findAll('.c-select-option').find((o) => o.text() === 'Model')
    expect(modelOption).toBeTruthy()
    await modelOption!.trigger('click')
    await flushPromises()

    expect(urlsContain('groupBy=model')).toBe(true)
    expect(urlsContain('groupBy=task')).toBe(true)

    const saved = JSON.parse(localStorage.getItem('dev-dashboard-statistics-prefs')!)
    expect(saved.charts).toHaveLength(2)
    expect(saved.charts[1].groupBy).toBe('model')

    // Xoá chart mới → còn 1.
    await wrapper.findAll('button[title="Bỏ chart này"]')[0].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.chart-tile')).toHaveLength(1)
  })

  it('tile resize → cập nhật span + height, persist', async () => {
    mockStats(statsBody(['TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    const tile = wrapper.findComponent({ name: 'ChartTile' })
    tile.vm.$emit('resize', 4, 420)
    await flushPromises()

    const saved = JSON.parse(localStorage.getItem('dev-dashboard-statistics-prefs')!)
    expect(saved.charts[0].span).toBe(4)
    expect(saved.charts[0].style.height).toBe(420)
  })

  it('gear mở dialog settings — sửa title áp live + persist', async () => {
    mockStats(statsBody(['TA1']))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    await wrapper.find('.chart-tile .chart-tile-actions .icon-btn').trigger('click')
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

  it('prefs bản đơn chart cũ migrate thành danh sách 1 phần tử', async () => {
    localStorage.setItem(
      'dev-dashboard-statistics-prefs',
      JSON.stringify({
        scope: 'project',
        rangeDays: 90,
        groupBy: 'model',
        metric: 'inputTokens',
        chartType: 'line',
        chart: { height: 400 },
      }),
    )
    mockStats(statsBody(['m1'], 'model'))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountWithI18n(StatisticsPanel, { props: { projectId: 'p1' } })
    await flushPromises()

    expect(urlQuery(lastUrl()).get('groupBy')).toBe('model')
    const card = wrapper.findComponent({ name: 'ChartCard' })
    expect(card.props('chartType')).toBe('line')
    expect(card.props('styleConfig').height).toBe(400)
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
    expect(wrapper.find('.statistics-summary-card').exists()).toBe(false)
  })
})
