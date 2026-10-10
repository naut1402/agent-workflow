import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount } from '../../../helpers/i18n'
import RunnerConfigPanel from '@/features/runner/components/RunnerConfigPanel.vue'
import McpPanel from '@/features/mcp/components/McpPanel.vue'
import McpServerDialog from '@/features/mcp/components/McpServerDialog.vue'
import runnerVi from '@/features/runner/locales/vi'
import runnerEn from '@/features/runner/locales/en'
import mcpVi from '@/features/mcp/locales/vi'

/**
 * TC-80…TC-83 — cấu trúc tab của màn Runner Config. Đây là bề mặt kiểm **AC-2**
 * ("tab MCP đặt NGAY SAU tab Runner") ở tầng nhanh; `test-e2e/mcp.spec.ts` là
 * lớp xác nhận thứ hai.
 *
 * ⚠️ TC-81 / TC-83 cũng là lưới chống hồi quy cho `test-e2e/runner.spec.ts`:
 * spec đó chờ `.runner-config` rồi thao tác `.runner-list li`, và 🚫 không được
 * sửa để cho xanh (TC-95).
 */

vi.mock('@/features/runner/scripts/runnerApi', () => ({
  fetchRunners: vi.fn(async () => ({ runners: [], defaultRunnerId: '', providers: [], connections: [] })),
}))

vi.mock('@/features/runner/scripts/RunnerConfigPanelApi', () => ({
  saveRunner: vi.fn(async (r: any) => ({ runner: r })),
  deleteRunner: vi.fn(async () => ({ deleted: true })),
  setDefaultRunner: vi.fn(async () => ({ ok: true })),
  fetchConnections: vi.fn(async () => ({ connections: [], providers: [] })),
}))

vi.mock('@/features/runner/scripts/ProviderDialogApi', () => ({
  fetchProviderConfigs: vi.fn(async () => ({ providerConfigs: [] })),
  saveProviderConfig: vi.fn(async (pc: any) => ({ providerConfig: pc })),
  deleteProviderConfig: vi.fn(async () => ({ deleted: true })),
}))

vi.mock('@/features/mcp/scripts/mcpApi', () => ({
  fetchMcpServers: vi.fn(async () => ({ servers: [] })),
  saveMcpServer: vi.fn(async (server: any) => ({ saved: true, server })),
  deleteMcpServer: vi.fn(async () => ({ deleted: true })),
  testMcpServer: vi.fn(async () => ({ ok: true, tools: [], warnings: [], durationMs: 1 })),
}))

// Panel nạp credential cho tab MCP (#483). Giữ bản thật cho các hàm còn lại —
// RunnerDialog / ConnectionDialog import chúng từ cùng module.
vi.mock('@/features/runner/scripts/ConnectionDialogApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/runner/scripts/ConnectionDialogApi')>()),
  fetchCredentials: vi.fn(async () => ({ profiles: [] })),
}))

import { fetchRunners } from '@/features/runner/scripts/runnerApi'
import { fetchConnections } from '@/features/runner/scripts/RunnerConfigPanelApi'
import { fetchProviderConfigs } from '@/features/runner/scripts/ProviderDialogApi'
import { fetchMcpServers } from '@/features/mcp/scripts/mcpApi'
import { fetchCredentials } from '@/features/runner/scripts/ConnectionDialogApi'

function qa<T extends Element = HTMLElement>(selector: string): T[] {
  return Array.from(document.body.querySelectorAll<T>(selector))
}
function tabs(): HTMLButtonElement[] {
  return qa<HTMLButtonElement>('[role="tablist"] [role="tab"]')
}
function tabByLabel(label: string): HTMLButtonElement {
  const tab = tabs().find((t) => t.textContent?.trim() === label)
  if (!tab) throw new Error(`tab not found: ${label}`)
  return tab
}
async function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await flushPromises()
}

async function mountPanel() {
  const w = mount(RunnerConfigPanel, { attachTo: document.body })
  await flushPromises()
  return w
}

const consoleErrors: unknown[][] = []
let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrors.length = 0
  consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args)
  })
  for (const fn of [fetchRunners, fetchConnections, fetchProviderConfigs, fetchMcpServers, fetchCredentials]) {
    vi.mocked(fn as any).mockClear()
  }
  vi.mocked(fetchCredentials).mockResolvedValue({ profiles: [] })
})

afterEach(() => {
  consoleSpy.mockRestore()
  document.body.innerHTML = ''
})

describe('RunnerConfigPanel — cấu trúc tab (AC-2)', () => {
  // TC-80 — ⚠️ assert THỨ TỰ DOM, không chỉ assert sự tồn tại.
  it('TC-80: đúng 2 tab, `Runner` trước, `MCP` NGAY SAU', async () => {
    await mountPanel()

    const list = tabs()
    expect(list).toHaveLength(2)
    expect(list[0].textContent?.trim()).toBe(runnerVi.tabs.runner)
    expect(list[1].textContent?.trim()).toBe(runnerVi.tabs.mcp)
    expect(qa('[role="tablist"]')[0].getAttribute('aria-label')).toBe(runnerVi.tabs.ariaLabel)
  })

  // TC-81 — hồi quy: `.runner-config` phải có mặt ngay sau khi mount.
  it('TC-81: tab mặc định là `Runner`', async () => {
    await mountPanel()

    expect(qa('.runner-config')).toHaveLength(1)
    expect(tabByLabel(runnerVi.tabs.runner).getAttribute('aria-selected')).toBe('true')
    expect(tabByLabel(runnerVi.tabs.mcp).getAttribute('aria-selected')).toBe('false')
  })

  /**
   * TC-82 — hệ quả quan sát được của việc render tab MCP bằng `v-if` thay vì ẩn
   * hiện bằng CSS: chưa mở tab thì 🚫 không gọi `/api/mcp-servers`.
   */
  it('TC-82: chưa mở tab MCP ⇒ chưa gọi API MCP; mở rồi ⇒ đúng 1 request', async () => {
    await mountPanel()
    expect(fetchMcpServers).not.toHaveBeenCalled()

    await click(tabByLabel(runnerVi.tabs.mcp))
    expect(fetchMcpServers).toHaveBeenCalledTimes(1)
  })

  // TC-83
  it('TC-83: chuyển qua lại giữa hai tab, 🚫 không lỗi console', async () => {
    await mountPanel()

    await click(tabByLabel(runnerVi.tabs.mcp))
    expect(qa('.runner-config')).toHaveLength(0)
    expect(qa('.mcp-panel')).toHaveLength(1)
    expect(document.body.textContent).toContain(mcpVi.panel.title)

    await click(tabByLabel(runnerVi.tabs.runner))
    expect(qa('.runner-config')).toHaveLength(1)
    expect(qa('.mcp-panel')).toHaveLength(0)
    // Danh sách runner vẫn dùng được (nút thêm runner còn đó).
    expect(qa('.runner-config button').length).toBeGreaterThan(0)

    await click(tabByLabel(runnerVi.tabs.mcp))
    expect(qa('.mcp-panel')).toHaveLength(1)

    expect(consoleErrors).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T6fabee9b · nhóm F của test-spec — màn Runner phải nói đúng runner nào job
// KHÔNG pin sẽ thật sự chạy.
//
// `defaultRunnerId` (id người dùng đã chốt) và `effectiveDefaultRunnerId` (runner
// thật sự chạy được) là HAI thứ khác nhau, và chúng lệch nhau đúng lúc có sự cố.
// Panel phải đọc trường thứ hai: ngôi sao sáng trên một runner mà job sẽ fail là
// chính loại lệch pha giữa "cái UI nói" và "cái hệ thống làm" mà task này đóng.
// ─────────────────────────────────────────────────────────────────────────────

const AI_CONNECTIONS = [
  { id: 'conn-a', providerId: 'anthropic-api' },
  { id: 'conn-b', providerId: 'anthropic-api' },
]
const TWO_RUNNERS = [
  { id: 'a', name: 'Runner A', connectionId: 'conn-a', enabled: false },
  { id: 'b', name: 'Runner B', connectionId: 'conn-b', enabled: true },
]

/** Nút đặt-default của một runner — tra theo aria-label, 🚫 không theo thứ tự DOM. */
function starButtons(): HTMLButtonElement[] {
  return qa<HTMLButtonElement>('.runner-list .icon-btn').filter(
    (b) => b.getAttribute('aria-label') === runnerVi.panel.makeDefault,
  )
}
function starFills(): (string | null)[] {
  return starButtons().map((b) => b.querySelector('svg path')?.getAttribute('fill') ?? null)
}

async function mountWithPayload(runnerPayload: Record<string, unknown>, connections = AI_CONNECTIONS) {
  vi.mocked(fetchRunners).mockResolvedValueOnce({ providers: [], connections: [], ...runnerPayload } as any)
  vi.mocked(fetchConnections).mockResolvedValueOnce({ connections, providers: [] } as any)
  return mountPanel()
}

describe('RunnerConfigPanel — default thật vs default đã ghi nhận', () => {
  it('TC-D34: effectiveDefaultRunnerId = null ⇒ 🚫 không ngôi sao nào sáng', async () => {
    await mountWithPayload({
      runners: TWO_RUNNERS,
      defaultRunnerId: 'a',
      effectiveDefaultRunnerId: null,
      defaultRunnerIssue: { runnerId: 'a', reason: 'disabled' },
    })

    expect(starButtons()).toHaveLength(2)
    // Sao chỉ đúng runner job sẽ chạy. `null` nghĩa là KHÔNG runner nào.
    expect(starFills()).toEqual(['none', 'none'])
  })

  it('TC-D35: defaultRunnerIssue ⇒ banner mang nội dung của key reason kèm id', async () => {
    await mountWithPayload({
      runners: TWO_RUNNERS,
      defaultRunnerId: 'a',
      effectiveDefaultRunnerId: null,
      defaultRunnerIssue: { runnerId: 'a', reason: 'disabled' },
    })

    const banner = qa('.warn-banner')
    expect(banner).toHaveLength(1)
    expect(banner[0].textContent).toBe(runnerVi.defaultIssue.disabled.replace('{id}', 'a'))
  })

  it('TC-D36: nút đặt-default trên chính runner hỏng VẪN bấm được', async () => {
    await mountWithPayload({
      runners: TWO_RUNNERS,
      defaultRunnerId: 'a',
      effectiveDefaultRunnerId: null,
      defaultRunnerIssue: { runnerId: 'a', reason: 'disabled' },
    })

    // Người dùng bật lại runner `a` rồi phải chốt lại được nó làm default —
    // khoá nút ở đây là nhốt họ trong trạng thái hỏng.
    expect(starButtons().map((b) => b.disabled)).toEqual([false, false])
  })

  it('payload cũ KHÔNG có effectiveDefaultRunnerId ⇒ rơi về defaultRunnerId (không vỡ mock cũ)', async () => {
    // `undefined` (thiếu trường) khác hẳn `null` (BE nói "không có runner nào
    // chạy được") — gộp hai thứ đó bằng `??` là xoá sạch tác dụng của TC-D34.
    await mountWithPayload({ runners: TWO_RUNNERS, defaultRunnerId: 'b' })

    expect(starFills()).toEqual(['none', 'currentColor'])
    expect(qa('.warn-banner')).toHaveLength(0)
  })
})

describe('RunnerConfigPanel — Copy mint id chưa dùng', () => {
  function hintText(): string {
    const hint = qa('.runner-dialog .cfg-hint')[0]
    if (!hint) throw new Error('không thấy dòng hint id trong RunnerDialog')
    return hint.textContent?.trim() ?? ''
  }

  it('TC-D37: copy khi `r-copy` đã tồn tại ⇒ đề xuất `r-copy-2`', async () => {
    await mountWithPayload(
      {
        runners: [
          { id: 'r', name: 'R', connectionId: 'conn-a' },
          { id: 'r-copy', name: 'R (copy)', connectionId: 'conn-a' },
        ],
        defaultRunnerId: 'r',
        effectiveDefaultRunnerId: 'r',
        defaultRunnerIssue: null,
      },
    )

    const copyBtn = qa<HTMLButtonElement>('.runner-list .icon-btn').find(
      (b) => b.getAttribute('aria-label') === runnerVi.panel.copyRunner,
    )!
    await click(copyBtn)

    expect(hintText()).toBe(runnerVi.hints.generatedId.replace('{id}', 'r-copy-2'))
  })

  it('TC-D37b: id dài ⇒ base bị cắt còn 48 TRƯỚC khi nối hậu tố', async () => {
    const long = 'a'.repeat(60)
    await mountWithPayload({
      runners: [{ id: long, name: 'Dài', connectionId: 'conn-a' }],
      defaultRunnerId: long,
      effectiveDefaultRunnerId: long,
      defaultRunnerIssue: null,
    })

    const copyBtn = qa<HTMLButtonElement>('.runner-list .icon-btn').find(
      (b) => b.getAttribute('aria-label') === runnerVi.panel.copyRunner,
    )!
    await click(copyBtn)

    const minted = hintText().replace(runnerVi.hints.generatedId.replace('{id}', ''), '')
    // Cắt SAU khi nối thì `sanitiseRunnerId` (64 ký tự) ăn mất chính hậu tố làm
    // nên khác biệt, và id "copy" lại trùng id gốc.
    expect(minted).toBe(`${'a'.repeat(48)}-copy`)
    expect(minted.length).toBeLessThanOrEqual(56)
  })
})

describe('TC-D42: locale phủ đủ tập reason của backend', () => {
  // `DefaultRunnerReason` của BE là union 7 giá trị; `ok` không có text nên FE
  // cần đúng 6 key. Thiếu một key thì banner hiện ra chính chuỗi khoá.
  const REASONS = ['no-runners', 'unset', 'missing', 'disabled', 'no-connection', 'not-ai'] as const

  it.each([
    ['vi', runnerVi],
    ['en', runnerEn],
  ])('%s: đủ 6 key defaultIssue.* + idTaken / connIdTaken / generatedId', (_locale, messages) => {
    expect(Object.keys((messages as any).defaultIssue).sort()).toEqual([...REASONS].sort())
    for (const reason of REASONS) {
      expect(typeof (messages as any).defaultIssue[reason]).toBe('string')
      expect((messages as any).defaultIssue[reason].length).toBeGreaterThan(0)
    }
    expect((messages as any).errors.idTaken).toContain('{id}')
    expect((messages as any).errors.connIdTaken).toContain('{id}')
    expect((messages as any).hints.generatedId).toContain('{id}')
  })
})

/**
 * TC-CX-07 · TC-CX-08 (#386, Tdf943817) — CX-3: cấu trúc DOM mà e2e và
 * TC-80…TC-83 bám vào 🚫 ĐƯỢC ĐỔI.
 *
 * `#386` đụng file này ở phần `<script setup>` bằng đúng một dòng
 * `fallow-ignore-file` (🚫 chẻ component, 🚫 đụng `<template>` — `implement.md`
 * §3 PR 2). Ca dưới khoá thẳng bất biến đó ở mức DOM, để nếu một vòng dọn
 * complexity sau này chẻ component thật thì nó đỏ ở ĐÂY — trong 2 giây — chứ
 * 🚫 phải ở `test-e2e/runner.spec.ts` sau 15 giây timeout.
 *
 * 🚫 Sửa TC-80…TC-83 ở trên: khối này CHỈ THÊM ca mới (`test-spec.md` §2.1).
 */
describe('#386 — bất biến DOM `.runner-config` (CX-3)', () => {
  // TC-CX-08
  it('TC-CX-08: `.runner-config` là gốc DUY NHẤT của tab Runner, e2e bám được', async () => {
    await mountPanel()

    const roots = qa('.runner-config')
    expect(roots).toHaveLength(1)
    // e2e chờ `.runner-config` **visible** rồi thao tác `.runner-list li` bên trong.
    expect(roots[0].querySelectorAll('.runner-list').length).toBeGreaterThanOrEqual(1)
    // Gốc nằm trong panel, 🚫 bị teleport ra ngoài — `page.locator` của e2e
    // tìm theo cây DOM của trang chứ 🚫 theo wrapper.
    expect(document.body.contains(roots[0])).toBe(true)
  })

  // TC-CX-07 — hai tab vẫn đổi qua lại được và 🚫 lỗi console sau khi tách.
  it('TC-CX-07: đổi tab qua lại ⇒ `.runner-config` xuất hiện/biến mất đúng, 🚫 lỗi console', async () => {
    await mountPanel()

    expect(qa('.runner-config')).toHaveLength(1)
    await click(tabByLabel(runnerVi.tabs.mcp))
    expect(qa('.runner-config')).toHaveLength(0)
    await click(tabByLabel(runnerVi.tabs.runner))
    expect(qa('.runner-config')).toHaveLength(1)

    expect(consoleErrors).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tcebe274e-P4 · #483 — credential thuộc `runner`, nên panel `runner` nạp rồi
// truyền xuống `McpPanel` → `McpServerDialog` qua props; feature `mcp` 🚫 gọi
// ngược API của `runner`.
// ─────────────────────────────────────────────────────────────────────────────

describe('RunnerConfigPanel — credential cho tab MCP (#483)', () => {
  const PROFILES = [
    { id: 'cred-1', label: 'GitHub MCP token' },
    { id: 'cred-2', label: 'Sentry' },
  ]

  it('TC-P4-01: chưa mở tab MCP ⇒ chưa gọi `/api/credentials`; mở ⇒ đúng 1 lần, `McpPanel` nhận danh sách', async () => {
    vi.mocked(fetchCredentials).mockResolvedValue({ profiles: PROFILES })
    const w = await mountPanel()
    expect(fetchCredentials).not.toHaveBeenCalled()

    await click(tabByLabel(runnerVi.tabs.mcp))

    expect(fetchCredentials).toHaveBeenCalledTimes(1)
    expect(w.findComponent(McpPanel).props('credentials')).toEqual(PROFILES)
  })

  it('TC-P4-02: mỗi lần quay lại tab MCP ⇒ nạp lại, credential vừa tạo ở tab Runner hiện ra', async () => {
    vi.mocked(fetchCredentials).mockResolvedValueOnce({ profiles: [PROFILES[0]] })
    const w = await mountPanel()
    await click(tabByLabel(runnerVi.tabs.mcp))
    expect(w.findComponent(McpPanel).props('credentials')).toEqual([PROFILES[0]])

    vi.mocked(fetchCredentials).mockResolvedValueOnce({ profiles: PROFILES })
    await click(tabByLabel(runnerVi.tabs.runner))
    await click(tabByLabel(runnerVi.tabs.mcp))

    expect(fetchCredentials).toHaveBeenCalledTimes(2)
    expect(w.findComponent(McpPanel).props('credentials')).toEqual(PROFILES)
  })

  it('TC-P4-03: `/api/credentials` lỗi ⇒ tab MCP vẫn dùng được, danh sách rỗng, 🚫 lỗi console', async () => {
    vi.mocked(fetchCredentials).mockRejectedValueOnce(new Error('HTTP 500'))
    const w = await mountPanel()

    await click(tabByLabel(runnerVi.tabs.mcp))

    expect(qa('.mcp-panel')).toHaveLength(1)
    expect(w.findComponent(McpPanel).props('credentials')).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  it('TC-P4-04: mở dialog thêm MCP server từ tab MCP ⇒ dialog nhận đúng credential panel đã nạp', async () => {
    vi.mocked(fetchCredentials).mockResolvedValue({ profiles: PROFILES })
    const w = await mountPanel()
    await click(tabByLabel(runnerVi.tabs.mcp))

    await click(qa<HTMLButtonElement>('.mcp-toolbar button')[0])

    const dialog = w.findComponent(McpServerDialog)
    expect(dialog.exists()).toBe(true)
    expect(dialog.props('credentials')).toEqual(PROFILES)
    expect(fetchCredentials).toHaveBeenCalledTimes(1)
  })
})
