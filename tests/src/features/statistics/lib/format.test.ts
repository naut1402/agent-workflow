import { describe, expect, it } from 'vitest'
import {
  compactNumber,
  formatNumber,
  fullNumber,
} from '@/features/statistics/lib/format'

describe('format số liệu thống kê', () => {
  it('compactNumber: đơn vị K/M/B, mantissa có dấu phẩy ngăn nghìn', () => {
    expect(compactNumber(999)).toBe('999')
    expect(compactNumber(1234)).toBe('1,234')
    expect(compactNumber(12345)).toBe('12.35K')
    expect(compactNumber(1234567)).toBe('1.23M')
    expect(compactNumber(12_345_678_900)).toBe('12.35B')
    expect(compactNumber(150_000)).toBe('150.0K')
  })

  it('fullNumber: dấu phẩy hàng nghìn', () => {
    expect(fullNumber(1234567)).toBe('1,234,567')
    expect(fullNumber(-42)).toBe('-42')
  })

  it('formatNumber theo tuỳ chọn compact/full', () => {
    expect(formatNumber(1234567, 'compact')).toBe('1.23M')
    expect(formatNumber(1234567, 'full')).toBe('1,234,567')
  })
})
