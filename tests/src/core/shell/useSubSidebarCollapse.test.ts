import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSubSidebarCollapse } from '@/core/shell/useSubSidebarCollapse'
import type { ModeEntry } from '@/core/shell/modeRegistry'

const PERSIST_KEY = 'dev-dashboard-monitor-subsidebar-collapsed'

function makeEntry(key: string, subSidebar?: ModeEntry['subSidebar']): ModeEntry {
  return {
    key,
    labelKey: `common.modes.${key}`,
    icon: 'monitor',
    order: 1,
    statusKind: 'paused',
    panel: { name: 'StubPanel', render: () => null },
    ...(subSidebar ? { subSidebar } : {}),
  }
}

/** monitor: có persist · editor: có sub-sidebar nhưng không persist · logs: không có sub-sidebar. */
function makeCollapse() {
  return useSubSidebarCollapse([
    makeEntry('monitor', { persistKey: PERSIST_KEY }),
    makeEntry('editor', {}),
    makeEntry('logs'),
  ])
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('useSubSidebarCollapse — has()', () => {
  it('chỉ true cho mode có khai `subSidebar`', () => {
    const sub = makeCollapse()
    expect(sub.has('monitor')).toBe(true)
    expect(sub.has('editor')).toBe(true)
    expect(sub.has('logs')).toBe(false)
    expect(sub.has('khong-ton-tai')).toBe(false)
  })
})

describe('useSubSidebarCollapse — toggle/set', () => {
  it('mặc định không collapsed, toggle lật state và lật lại', () => {
    const sub = makeCollapse()
    expect(sub.isCollapsed('monitor')).toBe(false)

    sub.toggle('monitor')
    expect(sub.isCollapsed('monitor')).toBe(true)

    sub.toggle('monitor')
    expect(sub.isCollapsed('monitor')).toBe(false)
  })

  it('state tách biệt theo từng mode', () => {
    const sub = makeCollapse()
    sub.toggle('monitor')
    expect(sub.isCollapsed('monitor')).toBe(true)
    expect(sub.isCollapsed('editor')).toBe(false)
  })

  it('set()/toggle() là no-op với mode không có sub-sidebar', () => {
    const sub = makeCollapse()
    sub.set('logs', true)
    sub.toggle('logs')
    expect(sub.isCollapsed('logs')).toBe(false)
  })
})

describe('useSubSidebarCollapse — persist', () => {
  it('ghi localStorage "1"/"0" khi mode khai persistKey', () => {
    const sub = makeCollapse()
    sub.set('monitor', true)
    expect(localStorage.getItem(PERSIST_KEY)).toBe('1')
    sub.set('monitor', false)
    expect(localStorage.getItem(PERSIST_KEY)).toBe('0')
  })

  it('không ghi localStorage khi mode không khai persistKey', () => {
    const sub = makeCollapse()
    sub.set('editor', true)
    expect(sub.isCollapsed('editor')).toBe(true)
    expect(localStorage.length).toBe(0)
  })

  it('hydrate ngay lúc khởi tạo từ giá trị đã lưu', () => {
    localStorage.setItem(PERSIST_KEY, '1')
    const sub = makeCollapse()
    expect(sub.isCollapsed('monitor')).toBe(true)
    expect(sub.isCollapsed('editor')).toBe(false)
  })

  it.each(['true', '', '0', 'yes'])('giá trị lạ %o trong localStorage coi như không collapsed', (raw) => {
    localStorage.setItem(PERSIST_KEY, raw)
    expect(makeCollapse().isCollapsed('monitor')).toBe(false)
  })

  it('localStorage bị chặn: vẫn đổi state trong RAM, không throw', () => {
    const sub = makeCollapse()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => sub.toggle('monitor')).not.toThrow()
    expect(sub.isCollapsed('monitor')).toBe(true)
  })

  it('localStorage đọc lỗi lúc hydrate: fallback về không collapsed', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(makeCollapse().isCollapsed('monitor')).toBe(false)
  })
})
