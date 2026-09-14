import { describe, expect, it } from 'vitest'
import {
  createStaticModeAccess,
  isEnabledByDefault,
  type ModeAccessContext,
  type ModeAccessProvider,
} from '@/frontend/shell/modeAccess'
import { createModeRegistry, type ModeEntry, type ModeRegistry } from '@/frontend/shell/modeRegistry'

const PANEL = { name: 'Stub', template: '<div />' }

function entry(key: string, extra: Partial<ModeEntry> = {}): ModeEntry {
  return {
    key,
    labelKey: `common.modes.${key}`,
    icon: 'monitor',
    order: 1,
    statusKind: 'paused',
    panel: PANEL,
    ...extra,
  } as ModeEntry
}

function registryOf(...entries: ModeEntry[]): ModeRegistry {
  const registry = createModeRegistry()
  entries.forEach((e, i) => registry.registerMode({ ...e, order: i + 1 }))
  return registry
}

describe('isEnabledByDefault — quy ước opt-out', () => {
  it('không khai gì → bật', () => {
    expect(isEnabledByDefault(entry('x'))).toBe(true)
  })

  it('`defaultEnabled: false` → tắt sẵn (mode chưa hoàn thiện)', () => {
    expect(isEnabledByDefault(entry('x', { defaultEnabled: false }))).toBe(false)
  })

  it('`alwaysOn` thắng cả `defaultEnabled: false`', () => {
    expect(isEnabledByDefault(entry('x', { alwaysOn: true, defaultEnabled: false }))).toBe(true)
  })

  it('mode không tồn tại → false', () => {
    expect(isEnabledByDefault(undefined)).toBe(false)
  })
})

describe('createStaticModeAccess (TC-D1, TC-D2, TC-D6)', () => {
  const registry = registryOf(
    entry('monitor', { alwaysOn: true }),
    entry('statistics'),
    entry('beta', { defaultEnabled: false }),
  )
  const access = createStaticModeAccess(registry)

  it('TC-D1: mode bật theo catalog → true', () => {
    expect(access.canAccessMode('statistics')).toBe(true)
    expect(access.canAccessMode('monitor')).toBe(true)
  })

  it('TC-D2: mode `defaultEnabled: false` → false', () => {
    expect(access.canAccessMode('beta')).toBe(false)
  })

  it('TC-D6: modeKey không có trong danh mục → false, không ném lỗi', () => {
    expect(() => access.canAccessMode('khong-ton-tai')).not.toThrow()
    expect(access.canAccessMode('khong-ton-tai')).toBe(false)
  })

  it('provider static không I/O — `load`/`applyOverrides` là no-op an toàn', async () => {
    await expect(access.load()).resolves.toBeUndefined()
    expect(() => access.applyOverrides({ enabled: { statistics: false } })).not.toThrow()
    expect(access.canAccessMode('statistics')).toBe(true)
  })
})

/**
 * Provider giả đóng vai nguồn role/permission trong DB của lượt sau. Nó khoá
 * **luật kết hợp** đã chốt (`mode-registry-guideline.md` §7):
 *
 *     canAccessMode = alwaysOn || (globalEnabled && userPermitted)
 *
 * Contract này phải đúng trước khi có DB, nếu không lượt thay nguồn sẽ đổi cả
 * hành vi chứ không chỉ đổi implementation.
 */
function createPermissionModeAccess(
  registry: ModeRegistry,
  globalEnabled: Record<string, boolean>,
  permittedByRole: Record<string, string[]>,
): ModeAccessProvider {
  return {
    canAccessMode(modeKey: string, ctx?: ModeAccessContext) {
      const mode = registry.getMode(modeKey)
      if (!mode) return false
      if (mode.alwaysOn) return true
      const global = globalEnabled[modeKey] ?? isEnabledByDefault(mode)
      if (!global) return false
      if (!ctx?.user) return true // single-user hôm nay: thiếu user không mất quyền
      return ctx.user.roles.some((role) => permittedByRole[role]?.includes(modeKey))
    },
    load: async () => {},
    applyOverrides: () => {},
  }
}

describe('luật kết hợp global × user (TC-D3, TC-D4, TC-D5)', () => {
  const registry = registryOf(entry('monitor', { alwaysOn: true }), entry('statistics'))
  const admin = { id: 'u1', roles: ['admin'] }
  const guest = { id: 'u2', roles: ['guest'] }
  const permitted = { admin: ['statistics'], guest: [] as string[] }

  it('TC-D3: tắt toàn cục thắng quyền user — có quyền vẫn ẩn', () => {
    const access = createPermissionModeAccess(registry, { statistics: false }, permitted)
    expect(access.canAccessMode('statistics', { user: admin })).toBe(false)
  })

  it('TC-D4: bật toàn cục nhưng user không có quyền → false (kết hợp là AND)', () => {
    const access = createPermissionModeAccess(registry, { statistics: true }, permitted)
    expect(access.canAccessMode('statistics', { user: guest })).toBe(false)
    expect(access.canAccessMode('statistics', { user: admin })).toBe(true)
  })

  it('TC-D5: không có user trong context → giữ quyền (chế độ single-user hiện tại)', () => {
    const access = createPermissionModeAccess(registry, { statistics: true }, permitted)
    expect(access.canAccessMode('statistics')).toBe(true)
    expect(access.canAccessMode('statistics', {})).toBe(true)
  })

  it('`alwaysOn` thắng cả hai lớp — dashboard luôn còn một mode', () => {
    const access = createPermissionModeAccess(registry, { monitor: false }, permitted)
    expect(access.canAccessMode('monitor', { user: guest })).toBe(true)
  })
})
