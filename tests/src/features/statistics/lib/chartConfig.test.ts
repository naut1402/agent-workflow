import { describe, expect, it } from 'vitest'
import {
  clampChartHeight,
  makeDefaultChartConfig,
  sanitizeChartConfig,
  snapChartHeight,
} from '@/features/statistics/lib/chartConfig'

describe('chartConfig — span/height clamp + sanitize prefs', () => {
  it('makeDefaultChartConfig: span 2, compact, bar theo task', () => {
    const c = makeDefaultChartConfig()
    expect(c.span).toBe(2)
    expect(c.numberFormat).toBe('compact')
    expect(c.chartType).toBe('bar')
    expect(c.groupBy).toBe('task')
    expect(c.id).toBeTruthy()
  })

  it('clampChartHeight / snapChartHeight', () => {
    expect(clampChartHeight(10)).toBe(180)
    expect(clampChartHeight(99999)).toBe(3000)
    // Snap bước 20px: 311 → 320, 305 → 300; dưới min → clamp lên 180.
    expect(snapChartHeight(311)).toBe(320)
    expect(snapChartHeight(305)).toBe(300)
    expect(snapChartHeight(9)).toBe(180)
    expect(snapChartHeight(99999)).toBe(3000)
  })

  it('sanitizeChartConfig: bỏ field lệch, giữ field hợp lệ, repair span/format', () => {
    const c = sanitizeChartConfig({
      id: 'x',
      title: 'T',
      groupBy: 'model',
      metric: 'bogus',
      chartType: 'line',
      span: 99,
      numberFormat: 'full',
      style: { height: 400, color: 'not-a-color' },
    })
    expect(c).toMatchObject({
      id: 'x',
      title: 'T',
      groupBy: 'model',
      metric: 'totalTokens',
      chartType: 'line',
      span: 4,
      numberFormat: 'full',
    })
    expect(c!.style.height).toBe(400)
    // Field lạ trong style không phá cấu trúc default.
    expect(c!.style.pieColors?.length).toBeGreaterThan(0)
  })

  it('sanitizeChartConfig: object rác → null', () => {
    expect(sanitizeChartConfig(null)).toBe(null)
    expect(sanitizeChartConfig('x')).toBe(null)
  })
})
