import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount } from '../../../helpers/i18n'
import RunnerConfigPanel from '@/features/runner/components/RunnerConfigPanel.vue'
import runnerVi from '@/features/runner/locales/vi'
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

import { fetchRunners } from '@/features/runner/scripts/runnerApi'
import { fetchConnections } from '@/features/runner/scripts/RunnerConfigPanelApi'
import { fetchProviderConfigs } from '@/features/runner/scripts/ProviderDialogApi'
import { fetchMcpServers } from '@/features/mcp/scripts/mcpApi'

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
  for (const fn of [fetchRunners, fetchConnections, fetchProviderConfigs, fetchMcpServers]) {
    vi.mocked(fn as any).mockClear()
  }
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
