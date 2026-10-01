import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount as mountRaw } from '@vue/test-utils'
import {
  createTestI18n,
  createTestI18nPlugin,
  mountWithI18n as mount,
} from '../../../helpers/i18n'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerLocale, supportedLocales } from '@/frontend/plugins/i18n'
import { useLocaleMessages } from '@/frontend/composables/useLocaleMessages'
import SettingsDialog from '@/features/settings/components/SettingsDialog.vue'
import {
  STORAGE_KEY,
  useAppSettings,
} from '@/frontend/composables/useAppSettings'

vi.mock('@/features/settings/scripts/SettingsDialogApi', () => ({
  fetchAutoscanConfig: vi.fn(async () => ({
    config: { enabled: false, whitelist: [], intervalMs: 60_000 },
  })),
  saveAutoscanConfig: vi.fn(async (c: object) => ({ config: c })),
  runAutoscan: vi.fn(async () => ({
    report: { added: [], existing: [], skipped: [], errors: [], hits: [], scanned: 0 },
  })),
  fetchGithubTokensConfig: vi.fn(async () => ({
    config: { repos: [{ repo: 'acme/app', token: 'ghp_old' }] },
  })),
  saveGithubTokensConfig: vi.fn(async (c: object) => ({ config: c })),
  fetchLoggingConfig: vi.fn(async () => ({
    config: {
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: false, usage: true },
    },
  })),
  saveLoggingConfig: vi.fn(async (c: object) => ({ config: c })),
  fetchScanPatternsConfig: vi.fn(async () => ({
    config: { agents: [], skills: [], rules: [] },
  })),
  saveScanPatternsConfig: vi.fn(async (c: object) => ({ config: c })),
}))

import {
  fetchLoggingConfig,
  saveLoggingConfig,
  saveScanPatternsConfig,
} from '@/features/settings/scripts/SettingsDialogApi'

beforeEach(() => {
  localStorage.clear()
  const { load } = useAppSettings()
  load()
})

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  const { load } = useAppSettings()
  load()
  vi.mocked(fetchLoggingConfig).mockReset()
  vi.mocked(saveLoggingConfig).mockReset()
  vi.mocked(fetchLoggingConfig).mockResolvedValue({
    config: {
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: false, usage: true },
    },
  })
  vi.mocked(saveLoggingConfig).mockImplementation(async (c: object) => ({ config: c }))
  vi.mocked(saveScanPatternsConfig).mockClear()
})

describe('SettingsDialog', () => {
  it('TC-U-01: nav General + all sections visible on pane', () => {
    mount(SettingsDialog, { attachTo: document.body })
    const nav = document.querySelector('.settings-nav') as HTMLElement
    const pane = document.querySelector('.settings-pane.modal-body') as HTMLElement
    expect(nav).toBeTruthy()
    expect(pane).toBeTruthy()
    expect(nav.textContent).toContain('Chung')
    expect(nav.textContent).toContain('Projects')
    expect(
      document.querySelector('.settings-nav-item.active[data-group="general"]'),
    ).toBeTruthy()
    const text = pane.textContent ?? ''
    expect(text).toContain('Giao diện')
    expect(text).toContain('Ngôn ngữ')
    expect(text).toContain('Artifact')
    expect(text).toContain('Danh sách task')
    expect(text).toContain('Sidebar')
    expect(text).toContain('Logs')
    expect(text).not.toContain('Autoscan')
  })

  it('logging section: shows type checkboxes when showLogsTab on; hides when off and persists', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    await flushPromises()

    const pane = document.querySelector('.settings-pane.modal-body') as HTMLElement
    expect(pane.textContent).toContain('Hiện tab Logs')
    expect(pane.textContent).toContain('Audit')
    expect(pane.textContent).toContain('Request')
    expect(pane.textContent).toContain('Jobs')
    expect(pane.textContent).toContain('Events')

    const checkboxes = Array.from(
      pane.querySelectorAll('.settings-section .settings-checkbox input[type="checkbox"]'),
    ) as HTMLInputElement[]
    // General group also has sidebar collapse checkboxes; logging block is last section with showTab + 4 types
    const showLogs = checkboxes.find((el) =>
      el.closest('label')?.textContent?.includes('Hiện tab Logs'),
    )
    expect(showLogs).toBeTruthy()
    expect(showLogs!.checked).toBe(true)

    showLogs!.checked = false
    showLogs!.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    expect(saveLoggingConfig).toHaveBeenCalledWith({
      showLogsTab: false,
      types: { audit: true, request: true, jobs: true, events: false, usage: true },
    })
    expect(pane.textContent).not.toContain('Loại log')
    expect(pane.textContent).not.toContain('Audit (thay đổi cấu hình)')
  })

  it('logging section: loads prefs from API (showLogsTab false hides types)', async () => {
    vi.mocked(fetchLoggingConfig).mockResolvedValueOnce({
      config: {
        showLogsTab: false,
        types: { audit: false, request: true, jobs: false, events: false, usage: true },
      },
    })
    mount(SettingsDialog, { attachTo: document.body })
    await flushPromises()

    const pane = document.querySelector('.settings-pane.modal-body') as HTMLElement
    expect(pane.textContent).toContain('Hiện tab Logs')
    expect(pane.textContent).not.toContain('Loại log')
    const showLogs = Array.from(pane.querySelectorAll('label.settings-checkbox')).find((el) =>
      el.textContent?.includes('Hiện tab Logs'),
    )?.querySelector('input') as HTMLInputElement
    expect(showLogs.checked).toBe(false)
  })

  it('mounts backdrop + title «Cài đặt»', () => {
    mount(SettingsDialog, { attachTo: document.body })
    expect(document.querySelector('.modal-backdrop')).toBeTruthy()
    expect(document.body.textContent).toContain('Cài đặt')
  })

  it('click .modal-close emits close', async () => {
    const w = mount(SettingsDialog, { attachTo: document.body })
    const closeBtn = document.querySelector('.modal-close') as HTMLButtonElement
    expect(closeBtn).toBeTruthy()
    closeBtn.click()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Escape keydown emits close', async () => {
    const w = mount(SettingsDialog, { attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('unmount removes keydown listener', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const w = mount(SettingsDialog, { attachTo: document.body })
    w.unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })

  it('TC-SD-01: empty localStorage → Block radio checked', () => {
    mount(SettingsDialog, { attachTo: document.body })
    const block = document.querySelector(
      'input[name="artifactViewMode"][value="block"]',
    ) as HTMLInputElement
    const full = document.querySelector(
      'input[name="artifactViewMode"][value="full"]',
    ) as HTMLInputElement
    expect(block.checked).toBe(true)
    expect(full.checked).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('TC-SD-02: chọn Full → persist artifactViewMode full', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    const full = document.querySelector(
      'input[name="artifactViewMode"][value="full"]',
    ) as HTMLInputElement
    full.checked = true
    full.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      artifactViewMode: 'full',
    })
  })

  it('TC-SD-03: seed full → Full radio checked', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ artifactViewMode: 'full' }))
    const { load } = useAppSettings()
    load()
    mount(SettingsDialog, { attachTo: document.body })
    const full = document.querySelector(
      'input[name="artifactViewMode"][value="full"]',
    ) as HTMLInputElement
    const block = document.querySelector(
      'input[name="artifactViewMode"][value="block"]',
    ) as HTMLInputElement
    expect(full.checked).toBe(true)
    expect(block.checked).toBe(false)
  })

  it('TC-SD-04 / TC-U-03: Esc vẫn emit close', async () => {
    const w = mount(SettingsDialog, { attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('TC-TH-01: empty localStorage → Hệ thống radio checked', () => {
    mount(SettingsDialog, { attachTo: document.body })
    const system = document.querySelector(
      'input[name="theme"][value="system"]',
    ) as HTMLInputElement
    expect(system.checked).toBe(true)
  })

  it('TC-TH-02: chọn Sáng → persist theme light + data-theme', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    const light = document.querySelector(
      'input[name="theme"][value="light"]',
    ) as HTMLInputElement
    light.checked = true
    light.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('TC-TH-03: seed dark → Tối radio checked', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'dark' }))
    const { load } = useAppSettings()
    load()
    mount(SettingsDialog, { attachTo: document.body })
    const dark = document.querySelector(
      'input[name="theme"][value="dark"]',
    ) as HTMLInputElement
    expect(dark.checked).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('sidebar section: toggling checkboxes persists collapse-on-outside prefs', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    expect(document.body.textContent).toContain('Sidebar')

    const labels = Array.from(document.querySelectorAll('.settings-checkbox'))
    const appLabel = labels.find((el) =>
      el.textContent?.includes('Tự thu gọn sidebar chính'),
    ) as HTMLElement
    const monitorLabel = labels.find((el) =>
      el.textContent?.includes('Tự thu gọn sub-sidebar Monitor'),
    ) as HTMLElement
    expect(appLabel).toBeTruthy()
    expect(monitorLabel).toBeTruthy()

    const appCb = appLabel.querySelector('input') as HTMLInputElement
    const monitorCb = monitorLabel.querySelector('input') as HTMLInputElement
    expect(appCb.checked).toBe(false)
    expect(monitorCb.checked).toBe(false)

    appCb.checked = true
    appCb.dispatchEvent(new Event('change', { bubbles: true }))
    monitorCb.checked = true
    monitorCb.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.collapseAppSidebarOnOutside).toBe(true)
    expect(stored.collapseMonitorSubSidebarOnOutside).toBe(true)
  })

  it('shows Projects autoscan section and toggles info tip on click', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    const projectsNav = document.querySelector(
      '.settings-nav-item[data-group="projects"]',
    ) as HTMLButtonElement
    expect(projectsNav).toBeTruthy()
    projectsNav.click()
    await flushPromises()

    const pane = document.querySelector('.settings-pane.modal-body') as HTMLElement
    expect(pane.textContent).toContain('Autoscan')
    expect(pane.textContent).toContain('Whitelist')
    expect(pane.textContent).toContain('Token GitHub')
    expect(pane.textContent).toContain('acme/app')

    const editBtn = Array.from(document.querySelectorAll('.settings-github-tokens .icon-btn')).find(
      (el) => (el as HTMLElement).getAttribute('aria-label') === 'Sửa',
    ) as HTMLButtonElement
    expect(editBtn).toBeTruthy()
    editBtn.click()
    await flushPromises()
    expect((document.querySelector('.settings-github-tokens-add input') as HTMLInputElement).value).toBe(
      'acme/app',
    )
    expect(pane.textContent).toContain('Cập nhật')
    expect(pane.textContent).toContain('Huỷ')

    const info = document.querySelector('.settings-info-btn') as HTMLButtonElement
    expect(info).toBeTruthy()
    expect(document.querySelector('.settings-info-tip')).toBeNull()

    info.click()
    await flushPromises()
    const tip = document.querySelector('.settings-info-tip') as HTMLElement
    expect(tip).toBeTruthy()
    expect(tip.textContent).toContain('60')
  })

  it('notifications position: dropdown defaults to both; change persists', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    const notifNav = document.querySelector(
      '.settings-nav-item[data-group="notifications"]',
    ) as HTMLButtonElement
    expect(notifNav).toBeTruthy()
    notifNav.click()
    await flushPromises()

    const pane = document.querySelector('.settings-pane.modal-body') as HTMLElement
    expect(pane.textContent).toContain('Vị trí hiển thị')

    const trigger = document.querySelector('.c-select-trigger') as HTMLButtonElement
    expect(trigger).toBeTruthy()
    expect(trigger.textContent).toContain('Cả sidebar và icon nổi')

    trigger.click()
    await flushPromises()
    const options = Array.from(document.querySelectorAll('.c-select-option')) as HTMLElement[]
    expect(options).toHaveLength(3)
    const floating = options.find((el) => el.textContent?.includes('Chỉ icon nổi'))
    expect(floating).toBeTruthy()
    floating!.click()
    await Promise.resolve()

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      notificationUiPlacement: 'floating',
    })
  })

  it('chat Enter section: defaults to "Enter sends" with nothing persisted', () => {
    mount(SettingsDialog, { attachTo: document.body })
    const send = document.querySelector(
      'input[name="chatEnterToSend"][value="send"]',
    ) as HTMLInputElement
    const newline = document.querySelector(
      'input[name="chatEnterToSend"][value="newline"]',
    ) as HTMLInputElement
    expect(send.checked).toBe(true)
    expect(newline.checked).toBe(false)
    // The old behaviour is the default, so it costs nothing in storage.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('chat Enter section: choosing "newline" persists chatEnterToSend false', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    const newline = document.querySelector(
      'input[name="chatEnterToSend"][value="newline"]',
    ) as HTMLInputElement
    newline.checked = true
    newline.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ chatEnterToSend: false })
  })

  it('chat Enter section: a seeded false shows the newline radio checked', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ chatEnterToSend: false }))
    const { load } = useAppSettings()
    load()
    mount(SettingsDialog, { attachTo: document.body })
    const send = document.querySelector(
      'input[name="chatEnterToSend"][value="send"]',
    ) as HTMLInputElement
    const newline = document.querySelector(
      'input[name="chatEnterToSend"][value="newline"]',
    ) as HTMLInputElement
    expect(newline.checked).toBe(true)
    expect(send.checked).toBe(false)
  })
})

describe('SettingsDialog — scan patterns', () => {
  const openProjects = async () => {
    mount(SettingsDialog, { attachTo: document.body })
    ;(document.querySelector('.settings-nav-item[data-group="projects"]') as HTMLButtonElement).click()
    await flushPromises()
    return document.querySelector('.settings-pane.modal-body') as HTMLElement
  }

  const kindBlock = (kind: string) =>
    document.querySelector(`.settings-scan-patterns .settings-subsection[data-kind="${kind}"]`) as HTMLElement

  const addPattern = async (kind: string, value: string) => {
    const block = kindBlock(kind)
    const input = block.querySelector('input') as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    ;(block.querySelector('.settings-whitelist-add button') as HTMLButtonElement).click()
    await flushPromises()
  }

  it('renders one list per kind inside the Projects group', async () => {
    const pane = await openProjects()
    expect(pane.textContent).toContain('Pattern scan agents / skills / rules')
    for (const kind of ['agents', 'skills', 'rules']) {
      expect(kindBlock(kind)).toBeTruthy()
    }
  })

  it('empty state names the defaults still in use', async () => {
    await openProjects()
    const empty = kindBlock('rules').querySelector('.settings-whitelist-empty') as HTMLElement
    expect(empty.textContent).toContain('Chưa có pattern')
    expect(empty.textContent).toContain('docs/agent-rules/')
  })

  it('adding a valid pattern persists it for that kind only', async () => {
    await openProjects()
    await addPattern('agents', './.agents/*.md')
    expect(vi.mocked(saveScanPatternsConfig)).toHaveBeenCalledWith({
      agents: ['.agents/*.md'],
      skills: [],
      rules: [],
    })
    expect(kindBlock('agents').textContent).toContain('.agents/*.md')
  })

  it('rejects an unsafe pattern in place without calling the API', async () => {
    const pane = await openProjects()
    await addPattern('rules', '../outside')
    expect(vi.mocked(saveScanPatternsConfig)).not.toHaveBeenCalled()
    expect(pane.textContent).toContain('Pattern không hợp lệ')
  })

  it('removing a pattern persists the shorter list', async () => {
    await openProjects()
    await addPattern('skills', 'packages/*/skills')
    vi.mocked(saveScanPatternsConfig).mockClear()
    const removeBtn = kindBlock('skills').querySelector(
      '.settings-whitelist-item .icon-btn',
    ) as HTMLButtonElement
    removeBtn.click()
    await flushPromises()
    expect(vi.mocked(saveScanPatternsConfig)).toHaveBeenCalledWith({
      agents: [],
      skills: [],
      rules: [],
    })
  })

  it('keeps several patterns of one kind in insertion order', async () => {
    await openProjects()
    await addPattern('rules', 'docs/rules')
    await addPattern('rules', 'guides')
    const shown = Array.from(
      kindBlock('rules').querySelectorAll('.settings-whitelist-path'),
    ).map((el) => el.textContent)
    expect(shown).toEqual(['docs/rules', 'guides'])
  })

  it('surfaces a failed save to the user', async () => {
    vi.mocked(saveScanPatternsConfig).mockRejectedValueOnce(new Error('boom'))
    const pane = await openProjects()
    await addPattern('agents', '.agents')
    expect(pane.textContent).toContain('boom')
  })
})

/**
 * [T0c6725e9] Khối Artifact — 2 preference trạng thái section.
 *
 * Bất biến chốt của nhóm này (AC-2b): accordion ép AC-1 ở **giá trị hiệu dụng**, KHÔNG
 * ghi đè giá trị đã lưu. Vì vậy control AC-1 bind theo giá trị ĐÃ LƯU: accordion bật
 * vẫn hiện đúng lựa chọn cũ của người dùng (và bị khoá), tắt lại là dùng được ngay.
 * TC-17 + TC-18 là hai case duy nhất phân biệt cài đặt đúng với cài đặt phá dữ liệu.
 */
describe('SettingsDialog — trạng thái section artifact (AC-1, AC-2)', () => {
  const i18n = createTestI18n('vi')
  const t = (key: string) => (i18n.global.t as any)(key)

  function sectionRadios() {
    return {
      expanded: document.querySelector(
        'input[name="artifactSectionDefault"][value="expanded"]',
      ) as HTMLInputElement,
      collapsed: document.querySelector(
        'input[name="artifactSectionDefault"][value="collapsed"]',
      ) as HTMLInputElement,
    }
  }

  function accordionCheckbox() {
    const label = Array.from(document.querySelectorAll('label.settings-checkbox')).find((l) =>
      l.textContent?.includes(t('settings.artifact.accordion')),
    )
    return label?.querySelector('input[type="checkbox"]') as HTMLInputElement
  }

  /** Tìm theo radio bên trong, không theo nhãn — nhãn đổi theo ngôn ngữ (TC-28). */
  function sectionRadioGroup() {
    return document
      .querySelector('input[name="artifactSectionDefault"]')
      ?.closest('[role="radiogroup"]') as HTMLElement
  }

  const forcedHintShown = () =>
    Array.from(document.querySelectorAll('.settings-section-desc')).some((p) =>
      p.textContent?.includes(t('settings.artifact.sectionForcedHint')),
    )

  /** Bấm checkbox accordion đúng như người dùng, rồi chờ Vue ghi xong. */
  async function clickAccordion() {
    accordionCheckbox().click()
    await flushPromises()
  }

  function seed(prefs?: Record<string, unknown>) {
    localStorage.clear()
    if (prefs) localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    useAppSettings().load()
  }

  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')

  it('TC-02: cài đặt sạch ⇒ accordion BẬT, AC-1 hiện "mở tất cả" nhưng bị KHOÁ', () => {
    seed()
    mount(SettingsDialog, { attachTo: document.body })

    expect(accordionCheckbox().checked).toBe(true)

    const { expanded, collapsed } = sectionRadios()
    // Cố ý hiện "mở tất cả" dù hành vi thực tế đang là đóng: "đóng" là do accordion
    // ép, không phải lựa chọn của người dùng (cặp bất biến với TC-17).
    expect(expanded.checked).toBe(true)
    expect(collapsed.checked).toBe(false)
    expect(expanded.disabled).toBe(true)
    expect(collapsed.disabled).toBe(true)

    // Mở dialog không được tự ghi gì xuống storage.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  /**
   * TC-15 · TC-29 — "khoá" phải ở mức THUỘC TÍNH của phần tử form, không phải bằng CSS:
   * radio khoá bằng style vẫn đổi được bằng chuột/bàn phím và vẫn ghi xuống storage.
   */
  it('TC-15/TC-29: accordion bật ⇒ 2 radio disabled thật, bấm và focus đều không đổi được', () => {
    seed()
    mount(SettingsDialog, { attachTo: document.body })
    const { expanded, collapsed } = sectionRadios()

    expect(collapsed.hasAttribute('disabled')).toBe(true)
    expect(sectionRadioGroup().getAttribute('aria-disabled')).toBe('true')

    // Chuột: phần tử form disabled không phát click/change (jsdom theo đúng spec).
    collapsed.click()
    expect(collapsed.checked).toBe(false)
    expect(expanded.checked).toBe(true)

    // Bàn phím: radio disabled bị loại khỏi vòng focus nên mũi tên không tới được.
    collapsed.focus()
    expect(document.activeElement).not.toBe(collapsed)

    expect(stored().artifactSectionDefault).toBeUndefined()
  })

  it('TC-16: accordion bật ⇒ có dòng hint nêu lý do; tắt ⇒ hint biến mất', async () => {
    seed()
    mount(SettingsDialog, { attachTo: document.body })
    expect(forcedHintShown()).toBe(true)

    await clickAccordion() // tắt
    expect(forcedHintShown()).toBe(false)
    expect(sectionRadios().expanded.disabled).toBe(false)

    await clickAccordion() // bật lại
    expect(forcedHintShown()).toBe(true)
  })

  /**
   * TC-17 · E10 — TC chốt của cả nhóm. `request.md` nói AC-1 "bị ép về đóng tất cả"
   * mà không nói ép ở tầng nào; spec chốt ép ở giá trị hiệu dụng. Cách cài còn lại
   * (ghi đè giá trị đã lưu khi bật accordion) xanh ở MỌI case khác — chỉ đường
   * bật-rồi-tắt dưới đây mới phân biệt được.
   */
  it('TC-17: đã lưu "đóng tất cả" ⇒ bật rồi tắt accordion KHÔNG ghi đè lựa chọn đó', async () => {
    seed({ artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' })
    mount(SettingsDialog, { attachTo: document.body })
    expect(sectionRadios().collapsed.checked).toBe(true)

    await clickAccordion() // bật accordion ⇒ AC-1 bị khoá
    expect(sectionRadios().collapsed.disabled).toBe(true)
    expect(sectionRadios().collapsed.checked).toBe(true)
    expect(stored().artifactSectionDefault).toBe('collapsed')

    await clickAccordion() // tắt lại
    expect(sectionRadios().collapsed.checked).toBe(true)
    expect(sectionRadios().collapsed.disabled).toBe(false)
    expect(stored()).toEqual({
      artifactSectionAccordion: false,
      artifactSectionDefault: 'collapsed',
    })
  })

  // TC-18: cùng bất biến với TC-17 nhưng ở nhánh CHƯA có giá trị lưu — chỗ mà một
  // cài đặt "bật thì ghi đè" để lại dấu vết rõ nhất ('collapsed' đọng lại).
  it('TC-18: chưa từng chỉnh AC-1 ⇒ round trip accordion vẫn để AC-1 ở "mở tất cả"', async () => {
    seed()
    mount(SettingsDialog, { attachTo: document.body })

    await clickAccordion() // tắt
    expect(sectionRadios().expanded.checked).toBe(true)

    await clickAccordion() // bật
    expect(sectionRadios().expanded.checked).toBe(true)

    await clickAccordion() // tắt lại
    expect(sectionRadios().expanded.checked).toBe(true)
    expect(sectionRadios().collapsed.checked).toBe(false)
    expect(stored().artifactSectionDefault).toBeUndefined()
  })

  it('TC-08/TC-15: accordion TẮT ⇒ chọn "đóng tất cả" ghi xuống storage và sống sót qua tải lại', async () => {
    seed({ artifactSectionAccordion: false })
    const first = mount(SettingsDialog, { attachTo: document.body })

    const { collapsed } = sectionRadios()
    expect(collapsed.disabled).toBe(false)
    collapsed.click()
    await flushPromises()

    expect(stored()).toEqual({
      artifactSectionAccordion: false,
      artifactSectionDefault: 'collapsed',
    })

    // Tải lại ứng dụng: dựng lại store từ storage rồi mount dialog mới.
    first.unmount()
    document.body.innerHTML = ''
    useAppSettings().load()
    mount(SettingsDialog, { attachTo: document.body })

    expect(sectionRadios().collapsed.checked).toBe(true)
    expect(sectionRadios().expanded.checked).toBe(false)
    // Nửa còn lại của TC-08 — "tài liệu mở ra đóng hết" — nằm ở TC-05 của 2 suite
    // viewer, seed đúng shape storage này.
  })

  /**
   * TC-20 · E3 — "tắt tường minh" phải thực sự xuống storage chứ không chỉ sống trong
   * phiên: vắng khoá và khoá `false` cho hai hành vi NGƯỢC nhau (TC-01 vs TC-04).
   */
  it('TC-20: tắt accordion ⇒ persist `false` và sống sót qua tải lại ứng dụng', async () => {
    seed()
    const first = mount(SettingsDialog, { attachTo: document.body })

    await clickAccordion()
    expect(stored().artifactSectionAccordion).toBe(false)

    // Tải lại: dựng lại store từ storage rồi mount dialog mới.
    first.unmount()
    document.body.innerHTML = ''
    useAppSettings().load()
    mount(SettingsDialog, { attachTo: document.body })

    expect(accordionCheckbox().checked).toBe(false)
    expect(sectionRadios().expanded.disabled).toBe(false)
    expect(sectionRadios().collapsed.disabled).toBe(false)
    expect(forcedHintShown()).toBe(false)
  })

  // TC-28: thiếu một khoá ở một ngôn ngữ là lỗi im lặng — chỉ lộ khi đổi ngôn ngữ.
  it.each(['vi', 'en'] as const)('TC-28: nhãn của cả 3 control có đủ ở %s', (locale) => {
    seed()
    const messages = createTestI18n(locale)
    const tr = (key: string) => (messages.global.t as any)(key)

    mountRaw(SettingsDialog, {
      attachTo: document.body,
      global: { plugins: [createTestI18nPlugin(locale)] },
    })

    const pane = document.querySelector('.settings-pane.modal-body') as HTMLElement
    const text = pane.textContent ?? ''
    for (const key of [
      'settings.artifact.accordion',
      'settings.artifact.sectionDesc',
      'settings.artifact.sectionExpanded',
      'settings.artifact.sectionCollapsed',
      'settings.artifact.sectionForcedHint',
    ]) {
      expect(text).toContain(tr(key))
      expect(tr(key)).not.toContain('settings.artifact.') // không rò khoá i18n thô
    }
    expect(sectionRadioGroup().getAttribute('aria-label')).toBe(
      tr('settings.artifact.sectionGroupLabel'),
    )
  })
})

/**
 * [T94b6ee41] Nhóm J của `test-spec.md` — chọn ngôn ngữ ở Settings.
 *
 * Trước task này radio ngôn ngữ KHÔNG có lưới nào: cả `SettingsDialog.test.ts` lẫn
 * `SettingsDialog.modes.test.ts` đều không assert `value="vi"` hay nhãn ngôn ngữ. Đây là
 * lần đầu vùng đó được phủ, không phải "sửa assert cứng".
 *
 * Bất biến chốt của nhóm: danh sách render từ REGISTRY (reactive), nhãn và chữ trạng thái
 * lấy từ khoá i18n. Thêm locale thứ ba là thêm thư mục JSON — 🚫 không sửa component nào.
 */
describe('SettingsDialog — chọn ngôn ngữ render từ registry', () => {
  /** Chữ `vi` đúng như bundle đang có — ca chốt "chữ này đến TỪ khoá", không chép tay. */
  const viI18n = createTestI18n('vi')
  const viText = (key: string) => (viI18n.global.t as (k: string) => string)(key)

  const COMPONENT_SOURCE = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../../src/features/settings/components/SettingsDialog.vue',
    ),
    'utf8',
  )

  function localeRadios(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll('input[type="radio"][name="locale"]'))
  }

  function localeGroup(): HTMLElement {
    return localeRadios()[0].closest('.settings-radio-group') as HTMLElement
  }

  function languageSection(): HTMLElement {
    return localeGroup().closest('.settings-section') as HTMLElement
  }

  afterEach(() => {
    const store = useLocaleMessages()
    store.pending.value = null
    store.lastError.value = null
    store.loadedLocales.value = []
    vi.unstubAllGlobals()
  })

  it('TC-J01: render đúng một radio cho mỗi locale đang hỗ trợ, 🚫 không hardcode', () => {
    mount(SettingsDialog, { attachTo: document.body })
    const radios = localeRadios()
    expect(radios.map((r) => r.value)).toEqual([...supportedLocales()])
    expect(radios.length).toBe(supportedLocales().length)
  })

  it('TC-J02: nhãn lấy từ `common.language.names.<code>`, 🚫 không chuỗi cứng trong component', () => {
    mount(SettingsDialog, { attachTo: document.body })
    const group = localeGroup()
    expect(group.textContent).toContain('Tiếng Việt')
    expect(group.textContent).toContain('English')
    // Chữ hiện ra đúng, nhưng phải đến TỪ khoá i18n — component 🚫 không được chứa nó.
    expect(COMPONENT_SOURCE).not.toContain('Tiếng Việt')
    expect(COMPONENT_SOURCE).not.toContain('>English<')
    expect(COMPONENT_SOURCE).toContain('common.language.names.')
    // Và 🚫 không lộ khoá thô ra DOM khi khoá tồn tại.
    expect(group.textContent).not.toContain('common.language')
  })

  it('TC-J03: locale đăng ký lúc chạy hiện ra mà KHÔNG phải sửa code hay reload (G-C13)', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    expect(localeRadios().map((r) => r.value)).not.toContain('ja')

    // Đúng thứ `ensureManifest()` làm khi manifest server về SAU lúc dialog đã mount.
    registerLocale('ja', { common: { language: { names: { ja: '日本語' } } } })
    await flushPromises()

    // Đỏ khi `localeRegistry` không reactive: computed cache vĩnh viễn, 'ja' không bao giờ hiện.
    expect(localeRadios().map((r) => r.value)).toContain('ja')

    // Nhãn đọc từ locale ĐANG hiển thị (`vi`), mà bản `vi` chưa có tên tiếng Nhật →
    // hiện chính mã thay vì lộ khoá thô. Dịch tên là việc của bundle `vi`.
    const label = localeRadios()
      .find((r) => r.value === 'ja')!
      .closest('.settings-radio') as HTMLElement
    expect(label.textContent?.trim()).toBe('ja')
    expect(label.textContent).not.toContain('common.language')
  })

  it('TC-J04: chọn một ngôn ngữ ⇒ đổi đúng một lần sang mã đó', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input))
        return new Response(JSON.stringify({ locale: 'en', messages: { common: { ok: 'OK' } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ETag: '"e1"' },
        })
      }),
    )

    mount(SettingsDialog, { attachTo: document.body })
    const en = localeRadios().find((r) => r.value === 'en')!
    expect(en.checked).toBe(false)

    en.click()
    await flushPromises()

    expect(calls).toEqual(['/api/i18n/en'])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).locale).toBe('en')
    expect(localeRadios().find((r) => r.value === 'en')!.checked).toBe(true)
  })

  it('TC-J05: đang nạp ⇒ hiện trạng thái chờ và KHOÁ lựa chọn (chặn double-submit)', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    expect(localeRadios().every((r) => r.disabled)).toBe(false)

    useLocaleMessages().pending.value = 'en'
    await flushPromises()

    expect(localeRadios().every((r) => r.disabled)).toBe(true)
    expect(languageSection().textContent).toContain(viText('settings.language.loading'))
  })

  it('TC-J06: nạp lỗi ⇒ báo ngay tại control, lựa chọn QUAY VỀ locale đang dùng', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))

    mount(SettingsDialog, { attachTo: document.body })
    // `de` chưa có messages build-time → nạp hỏng là thật sự không đổi được.
    registerLocale('de', {})
    await flushPromises()
    localeRadios().find((r) => r.value === 'de')!.click()
    await flushPromises()

    const section = languageSection()
    expect(section.querySelector('[role="alert"]')).not.toBeNull()
    expect(section.textContent).toContain(viText('settings.language.loadFailed'))
    // 🚫 Không "giả vờ đã đổi": lựa chọn hiển thị vẫn là locale đang dùng.
    expect(localeRadios().find((r) => r.value === 'vi')!.checked).toBe(true)
    expect(localeRadios().find((r) => r.value === 'de')!.checked).toBe(false)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').locale).toBeUndefined()
  })

  it('TC-J07: nhãn loading/lỗi cũng i18n hoá, 🚫 không hardcode trong component', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    useLocaleMessages().lastError.value = 'i18n 500'
    await flushPromises()

    expect(languageSection().textContent).toContain(viText('settings.language.loadFailed'))
    expect(COMPONENT_SOURCE).toContain("t('settings.language.loading')")
    expect(COMPONENT_SOURCE).toContain("t('settings.language.loadFailed')")
    expect(COMPONENT_SOURCE).not.toContain(viText('settings.language.loadFailed'))
  })
})
