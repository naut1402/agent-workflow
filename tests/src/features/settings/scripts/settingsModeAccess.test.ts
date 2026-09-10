import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/settings/scripts/SettingsDialogApi', () => ({
  fetchModesConfig: vi.fn(async () => ({ config: { enabled: {} } })),
}))

import { createSettingsModeAccess } from '@/features/settings/scripts/settingsModeAccess'
import { fetchModesConfig } from '@/features/settings/scripts/SettingsDialogApi'
import { createModeRegistry, type ModeEntry, type ModeRegistry } from '@/core/shell/modeRegistry'

const PANEL = { name: 'Stub', template: '<div />' }

function registryOf(...entries: Partial<ModeEntry>[]): ModeRegistry {
  const registry = createModeRegistry()
  entries.forEach((e, i) =>
    registry.registerMode({
      labelKey: `common.modes.${e.key}`,
      icon: 'monitor',
      statusKind: 'paused',
      panel: PANEL,
      order: i + 1,
      ...e,
    } as ModeEntry),
  )
  return registry
}

let registry: ModeRegistry

beforeEach(() => {
  registry = registryOf(
    { key: 'monitor', alwaysOn: true },
    { key: 'statistics' },
    { key: 'beta', defaultEnabled: false },
  )
  vi.mocked(fetchModesConfig).mockReset()
  vi.mocked(fetchModesConfig).mockResolvedValue({ config: { enabled: {} } })
})

describe('createSettingsModeAccess', () => {
  it('TC-C1: chưa nạp gì → mọi mode theo mặc định của catalog', () => {
    const access = createSettingsModeAccess(registry)
    expect(access.canAccessMode('statistics')).toBe(true)
    expect(access.canAccessMode('monitor')).toBe(true)
    expect(access.canAccessMode('beta')).toBe(false)
  })

  it('TC-D2: cấu hình đã lưu tắt mode → canAccessMode false sau khi load', async () => {
    vi.mocked(fetchModesConfig).mockResolvedValue({ config: { enabled: { statistics: false } } })
    const access = createSettingsModeAccess(registry)
    await access.load()
    expect(access.canAccessMode('statistics')).toBe(false)
  })

  it('TC-C5: mode không có trong cấu hình vẫn theo `defaultEnabled` của nó', async () => {
    vi.mocked(fetchModesConfig).mockResolvedValue({ config: { enabled: { statistics: false } } })
    const access = createSettingsModeAccess(registry)
    await access.load()
    expect(access.canAccessMode('beta')).toBe(false)
    expect(access.canAccessMode('monitor')).toBe(true)
  })

  it('TC-C6: cấu hình ghi `monitor: false` (sửa tay) không lật được mode alwaysOn', async () => {
    vi.mocked(fetchModesConfig).mockResolvedValue({ config: { enabled: { monitor: false } } })
    const access = createSettingsModeAccess(registry)
    await access.load()
    expect(access.canAccessMode('monitor')).toBe(true)
  })

  it('TC-D9: endpoint lỗi → giữ mặc định an toàn, load không ném lỗi', async () => {
    vi.mocked(fetchModesConfig).mockRejectedValue(new Error('boom'))
    const access = createSettingsModeAccess(registry)
    await expect(access.load()).resolves.toBeUndefined()
    expect(access.canAccessMode('statistics')).toBe(true)
    expect(access.canAccessMode('monitor')).toBe(true)
  })

  it('TC-C3: cấu hình hỏng từ server → bỏ qua entry rác, không mất mode', async () => {
    vi.mocked(fetchModesConfig).mockResolvedValue({
      config: { enabled: { statistics: 'nope', beta: true } },
    })
    const access = createSettingsModeAccess(registry)
    await access.load()
    expect(access.canAccessMode('statistics')).toBe(true)
    expect(access.canAccessMode('beta')).toBe(true)
  })

  it('TC-D6: modeKey lạ → false, không ném lỗi', () => {
    const access = createSettingsModeAccess(registry)
    expect(access.canAccessMode('khong-ton-tai')).toBe(false)
  })

  it('TC-D8: applyOverrides đổi kết quả ngay, không cần fetch lại', async () => {
    const access = createSettingsModeAccess(registry)
    await access.load()
    expect(access.canAccessMode('statistics')).toBe(true)

    access.applyOverrides({ enabled: { statistics: false } })
    expect(access.canAccessMode('statistics')).toBe(false)
    expect(vi.mocked(fetchModesConfig)).toHaveBeenCalledTimes(1)

    access.applyOverrides({ enabled: { statistics: true } })
    expect(access.canAccessMode('statistics')).toBe(true)
  })

  it('applyOverrides với payload rác không làm mất mode nào', async () => {
    const access = createSettingsModeAccess(registry)
    await access.load()
    access.applyOverrides('rác')
    expect(access.canAccessMode('statistics')).toBe(true)
  })
})
