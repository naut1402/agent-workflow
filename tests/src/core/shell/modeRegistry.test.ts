import { describe, expect, it } from 'vitest'
import { createModeRegistry, type ModeEntry } from '@/core/shell/modeRegistry'

function makeEntry(overrides: Partial<ModeEntry> = {}): ModeEntry {
  return {
    key: 'monitor',
    labelKey: 'common.modes.monitor',
    icon: 'monitor',
    order: 1,
    statusKind: 'live',
    panel: { name: 'StubPanel', render: () => null },
    ...overrides,
  }
}

describe('modeRegistry', () => {
  it('registerMode + getMode trả đúng entry theo key', () => {
    const registry = createModeRegistry()
    const entry = makeEntry()
    registry.registerMode(entry)
    expect(registry.getMode('monitor')).toBe(entry)
  })

  it('getMode trả undefined khi key chưa đăng ký', () => {
    const registry = createModeRegistry()
    expect(registry.getMode('missing')).toBeUndefined()
  })

  it('listModes() sort theo order tăng dần, không phụ thuộc thứ tự đăng ký', () => {
    const registry = createModeRegistry()
    registry.registerMode(makeEntry({ key: 'statistics', order: 9 }))
    registry.registerMode(makeEntry({ key: 'monitor', order: 1 }))
    registry.registerMode(makeEntry({ key: 'editor', order: 2 }))

    expect(registry.listModes().map((m) => m.key)).toEqual(['monitor', 'editor', 'statistics'])
  })

  it('registerMode() throw khi trùng key', () => {
    const registry = createModeRegistry()
    registry.registerMode(makeEntry({ key: 'monitor' }))
    expect(() => registry.registerMode(makeEntry({ key: 'monitor', order: 2 }))).toThrow(/monitor/)
  })
})
