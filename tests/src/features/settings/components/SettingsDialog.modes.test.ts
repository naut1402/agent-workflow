import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount, createTestI18n } from '../../../helpers/i18n'
import SettingsDialog from '@/features/settings/components/SettingsDialog.vue'
import { useAppSettings } from '@/frontend/composables/useAppSettings'
import type { ModeEntry } from '@/frontend/shell/modeRegistry'

vi.mock('@/features/settings/scripts/SettingsDialogApi', () => ({
  fetchAutoscanConfig: vi.fn(async () => ({
    config: { enabled: false, whitelist: [], intervalMs: 60_000 },
  })),
  saveAutoscanConfig: vi.fn(async (c: object) => ({ config: c })),
  runAutoscan: vi.fn(async () => ({
    report: { added: [], existing: [], skipped: [], errors: [], hits: [], scanned: 0 },
  })),
  fetchGithubTokensConfig: vi.fn(async () => ({ config: { repos: [] } })),
  saveGithubTokensConfig: vi.fn(async (c: object) => ({ config: c })),
  fetchLoggingConfig: vi.fn(async () => ({
    config: {
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: false, usage: true },
    },
  })),
  saveLoggingConfig: vi.fn(async (c: object) => ({ config: c })),
  fetchModesConfig: vi.fn(async () => ({ config: { enabled: {} } })),
  saveModesConfig: vi.fn(async (c: { enabled?: Record<string, boolean> }) => ({
    config: { enabled: { ...(c.enabled ?? {}) } },
  })),
  fetchRecoveryConfig: vi.fn(async () => ({ config: {} })),
  saveRecoveryConfig: vi.fn(async (c: object) => ({ config: c })),
  fetchScanPatternsConfig: vi.fn(async () => ({ config: { agents: [], skills: [], rules: [] } })),
  saveScanPatternsConfig: vi.fn(async (c: object) => ({ config: c })),
}))

import {
  fetchLoggingConfig,
  fetchModesConfig,
  saveModesConfig,
} from '@/features/settings/scripts/SettingsDialogApi'

const i18n = createTestI18n('vi')
const t = (key: string, params?: Record<string, unknown>) =>
  (i18n.global.t as any)(key, params ?? {})

const PANEL = { name: 'Stub', template: '<div />' }

function mode(key: string, extra: Partial<ModeEntry> = {}): ModeEntry {
  return {
    key,
    labelKey: `common.modes.${key}`,
    descriptionKey: `common.modeDesc.${key}`,
    icon: 'monitor',
    order: 1,
    statusKind: 'paused',
    panel: PANEL,
    maturity: 'stable',
    ...extra,
  } as ModeEntry
}

const CATALOG: ModeEntry[] = [
  mode('monitor', { alwaysOn: true }),
  mode('knowledge'),
  mode('logs'),
  mode('statistics'),
]

function openModesGroup(catalog: ModeEntry[] = CATALOG) {
  const wrapper = mount(SettingsDialog, {
    attachTo: document.body,
    props: { modeCatalog: catalog },
  })
  return wrapper
}

async function selectModesGroup(wrapper: ReturnType<typeof openModesGroup>) {
  // Dialog teleport ra body nên query qua document, không qua cây của wrapper.
  const tab = document.querySelector('.settings-nav [data-group="modes"]') as HTMLElement | null
  expect(tab?.textContent?.trim()).toBe(t('settings.groups.modes'))
  tab!.click()
  await flushPromises()
  await wrapper.vm.$nextTick()
}

function rows() {
  return Array.from(document.querySelectorAll('.settings-mode-row')) as HTMLElement[]
}

function checkboxes() {
  return rows().map((r) => r.querySelector('input[type="checkbox"]') as HTMLInputElement)
}

beforeEach(() => {
  localStorage.clear()
  useAppSettings().load()
  vi.mocked(fetchModesConfig).mockReset()
  vi.mocked(saveModesConfig).mockReset()
  vi.mocked(fetchModesConfig).mockResolvedValue({ config: { enabled: {} } })
  vi.mocked(saveModesConfig).mockImplementation(async (c: { enabled?: Record<string, boolean> }) => ({
    config: { enabled: { ...(c.enabled ?? {}) } },
  }))
  vi.mocked(fetchLoggingConfig).mockResolvedValue({
    config: {
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: false, usage: true },
    },
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  useAppSettings().load()
  vi.restoreAllMocks()
})

describe('SettingsDialog — group "Chế độ" (AC-1, AC-2)', () => {
  it('TC-A1: có nhóm cấu hình mode, liệt kê đủ mode của catalog, mỗi mode một control', async () => {
    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)

    expect(rows()).toHaveLength(CATALOG.length)
    expect(checkboxes().every((c) => c instanceof HTMLInputElement)).toBe(true)
    expect(checkboxes().every((c) => c.checked)).toBe(true)
  })

  it('TC-A2: mỗi dòng hiện label + mô tả người đọc được, không lộ khoá i18n thô', async () => {
    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)

    const text = rows()[1].textContent ?? ''
    expect(text).toContain(t('common.modes.knowledge'))
    expect(text).toContain(t('common.modeDesc.knowledge'))
    expect(text).not.toContain('common.modes.')
    expect(text).not.toContain('modeDesc.')
  })

  it('TC-A3: mode chưa hoàn thiện có badge; mode ổn định không có', async () => {
    const wrapper = openModesGroup([
      mode('monitor', { alwaysOn: true }),
      mode('knowledge', { maturity: 'beta' }),
      mode('statistics'),
    ])
    await selectModesGroup(wrapper)

    const badges = rows().map((r) => r.querySelector('.settings-mode-badge'))
    expect(badges[0]).toBeNull()
    expect(badges[1]?.textContent?.trim()).toBe(t('settings.modes.maturity.beta'))
    expect(badges[2]).toBeNull()
  })

  it('TC-A4: mode mới trong catalog tự xuất hiện — không có danh sách thứ hai chép tay', async () => {
    const wrapper = openModesGroup([...CATALOG, mode('brandNew', { maturity: 'experimental' })])
    await selectModesGroup(wrapper)

    expect(rows()).toHaveLength(CATALOG.length + 1)
    expect(rows()[4].textContent).toContain(t('settings.modes.maturity.experimental'))
  })

  it('TC-A5: monitor không tắt được — control khoá kèm giải thích', async () => {
    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)

    expect(checkboxes()[0].disabled).toBe(true)
    expect(rows()[0].getAttribute('title')).toBe(t('settings.modes.alwaysOnHint'))
    expect(checkboxes()[1].disabled).toBe(false)
  })

  it('TC-A6: tắt một mode → gửi đi đúng giá trị mới và hiện phản hồi đã lưu', async () => {
    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)

    checkboxes()[3].click()
    await flushPromises()
    await flushPromises()

    expect(vi.mocked(saveModesConfig)).toHaveBeenCalledWith({ enabled: { statistics: false } })
    expect(checkboxes()[3].checked).toBe(false)
    expect(document.body.textContent).toContain(t('settings.modes.saved'))
  })

  it('TC-A7/TC-C14: chỉ gửi delta của mode vừa đụng — không sinh entry cho 8 mode kia', async () => {
    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)

    checkboxes()[3].click()
    await flushPromises()
    await flushPromises()
    checkboxes()[3].click()
    await flushPromises()
    await flushPromises()

    const calls = vi.mocked(saveModesConfig).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toEqual({ enabled: { statistics: false } })
    expect(calls[1][0]).toEqual({ enabled: { statistics: true } })
    for (const [body] of calls) {
      expect(Object.keys(body.enabled ?? {})).not.toContain('monitor')
    }
    expect(checkboxes()[3].checked).toBe(true)
  })

  it('phát `dev-dashboard:modes-changed` với cấu hình đã merge ở server, không phải map cục bộ', async () => {
    vi.mocked(saveModesConfig).mockResolvedValue({
      config: { enabled: { knowledge: false, statistics: false } },
    })
    const events: unknown[] = []
    const listener = (e: Event) => events.push((e as CustomEvent).detail)
    window.addEventListener('dev-dashboard:modes-changed', listener)

    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)
    checkboxes()[3].click()
    await flushPromises()
    await flushPromises()

    window.removeEventListener('dev-dashboard:modes-changed', listener)
    expect(events).toEqual([{ enabled: { knowledge: false, statistics: false } }])
  })

  it('TC-A9: nạp lỗi → báo lỗi, hiện mặc định catalog (không "tắt hết") và khoá thao tác', async () => {
    vi.mocked(fetchModesConfig).mockRejectedValue(new Error('mạng hỏng'))
    const wrapper = openModesGroup([
      mode('monitor', { alwaysOn: true }),
      mode('knowledge'),
      mode('beta', { defaultEnabled: false }),
    ])
    await selectModesGroup(wrapper)

    expect(document.body.textContent).toContain(t('settings.modes.loadError'))
    expect(checkboxes()[1].checked).toBe(true)
    expect(checkboxes()[2].checked).toBe(false)
    expect(checkboxes().every((c) => c.disabled)).toBe(true)
  })

  it('TC-A8/TC-A10: ghi lỗi → báo lỗi, control trở lại giá trị cũ, không hiện "đã lưu"', async () => {
    vi.mocked(saveModesConfig).mockRejectedValue(new Error('đĩa đầy'))
    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)

    checkboxes()[3].click()
    await flushPromises()
    await flushPromises()

    expect(checkboxes()[3].checked).toBe(true)
    expect(document.body.textContent).toContain('đĩa đầy')
    expect(document.body.textContent).not.toContain(t('settings.modes.saved'))
  })

  it('trạng thái đã lưu hiện lại đúng khi mở lại dialog (TC-A6)', async () => {
    vi.mocked(fetchModesConfig).mockResolvedValue({ config: { enabled: { statistics: false } } })
    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)

    expect(checkboxes()[3].checked).toBe(false)
    expect(checkboxes()[1].checked).toBe(true)
  })

  it('TC-C4: khoá mode lạ trong cấu hình không sinh dòng "ma"', async () => {
    vi.mocked(fetchModesConfig).mockResolvedValue({
      config: { enabled: { modeDaBiGo: false, statistics: false } },
    })
    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)

    expect(rows()).toHaveLength(CATALOG.length)
    expect(document.body.textContent).not.toContain('modeDaBiGo')
  })

  it('TC-C6: cấu hình ghi monitor=false không lật được mode alwaysOn', async () => {
    vi.mocked(fetchModesConfig).mockResolvedValue({ config: { enabled: { monitor: false } } })
    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)

    expect(checkboxes()[0].checked).toBe(true)
    expect(checkboxes()[0].disabled).toBe(true)
  })

  it('TC-R8: hàng logs nêu rõ còn công tắc thứ hai đang tắt', async () => {
    vi.mocked(fetchLoggingConfig).mockResolvedValue({
      config: {
        showLogsTab: false,
        types: { audit: true, request: true, jobs: true, events: false, usage: true },
      },
    })
    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)

    expect(rows()[2].textContent).toContain(t('settings.modes.logsAlsoHiddenHint'))
    expect(rows()[3].textContent).not.toContain(t('settings.modes.logsAlsoHiddenHint'))
  })

  it('cờ cũ đang bật → hàng logs không hiện ghi chú thừa', async () => {
    const wrapper = openModesGroup()
    await selectModesGroup(wrapper)

    expect(rows()[2].textContent).not.toContain(t('settings.modes.logsAlsoHiddenHint'))
  })
})
