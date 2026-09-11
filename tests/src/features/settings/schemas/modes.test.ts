import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODES_CONFIG,
  MODES_MAX_KEYS,
  MODE_KEY_PATTERN,
  parseModesConfig,
  resolveModeEnabled,
} from '@/features/settings/schemas/modes'

describe('parseModesConfig — tolerant per-entry (TC-C3, TC-C4, TC-C9b, TC-C10)', () => {
  it('TC-C1/TC-C2: thiếu nhánh cấu hình → map rỗng, không mode nào bị tắt ngoài ý muốn', () => {
    expect(parseModesConfig(undefined)).toEqual(DEFAULT_MODES_CONFIG)
    expect(parseModesConfig(null)).toEqual({ enabled: {} })
    expect(parseModesConfig({})).toEqual({ enabled: {} })
  })

  it('TC-C3: dữ liệu hỏng hẳn → mặc định an toàn, không ném lỗi', () => {
    expect(parseModesConfig('nope')).toEqual({ enabled: {} })
    expect(parseModesConfig(42)).toEqual({ enabled: {} })
    expect(parseModesConfig({ enabled: 'nope' })).toEqual({ enabled: {} })
    expect(parseModesConfig({ enabled: null })).toEqual({ enabled: {} })
  })

  it('TC-C9b: một entry sai kiểu chỉ mất riêng nó, phần hợp lệ vẫn giữ', () => {
    expect(parseModesConfig({ enabled: { statistics: false, logs: 'nope', runner: true } })).toEqual(
      { enabled: { statistics: false, runner: true } },
    )
  })

  it('TC-C10: khoá dị dạng bị loại, không ô nhiễm prototype', () => {
    const parsed = parseModesConfig(
      JSON.parse('{"enabled":{"__proto__":true,"9lives":true,"a b":true,"ok":true}}'),
    )
    expect(parsed).toEqual({ enabled: { ok: true } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(parsed.enabled)).toBe(Object.prototype)
  })

  it('TC-C10: khoá dài quá 64 ký tự bị loại', () => {
    expect(MODE_KEY_PATTERN.test('a'.repeat(64))).toBe(true)
    expect(MODE_KEY_PATTERN.test('a'.repeat(65))).toBe(false)
    expect(parseModesConfig({ enabled: { ['a'.repeat(65)]: true, ok: false } })).toEqual({
      enabled: { ok: false },
    })
  })

  it('TC-C10: mảng không sinh entry nào — khoá "0"/"1" không hợp lệ', () => {
    expect(parseModesConfig({ enabled: [true, false] })).toEqual({ enabled: {} })
  })

  it('TC-C10: map quá lớn bị chặn ở mức trần, file settings không phình vô hạn', () => {
    const enabled: Record<string, boolean> = {}
    for (let i = 0; i < MODES_MAX_KEYS + 20; i++) enabled[`mode${i}`] = true
    expect(Object.keys(parseModesConfig({ enabled }).enabled)).toHaveLength(MODES_MAX_KEYS)
  })

  it('bỏ qua field lạ cạnh `enabled` mà không mất `enabled`', () => {
    expect(parseModesConfig({ enabled: { logs: false }, futureField: { a: 1 } })).toEqual({
      enabled: { logs: false },
    })
  })
})

describe('resolveModeEnabled — mặc định của catalog (TC-C5)', () => {
  it('TC-C5: mode chưa có trong cấu hình dùng đúng `defaultEnabled` của nó', () => {
    const config = { enabled: { logs: false } }
    expect(resolveModeEnabled(config, 'statistics', true)).toBe(true)
    expect(resolveModeEnabled(config, 'experimentalMode', false)).toBe(false)
  })

  it('giá trị đã lưu thắng mặc định, cả hai chiều', () => {
    expect(resolveModeEnabled({ enabled: { logs: false } }, 'logs', true)).toBe(false)
    expect(resolveModeEnabled({ enabled: { logs: true } }, 'logs', false)).toBe(true)
  })

  it('cấu hình null/undefined → mặc định, không ném lỗi', () => {
    expect(resolveModeEnabled(null, 'logs', true)).toBe(true)
    expect(resolveModeEnabled(undefined, 'logs', false)).toBe(false)
  })
})
