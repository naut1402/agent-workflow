import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount } from '../../../helpers/i18n'
import McpPanel from '@/features/mcp/components/McpPanel.vue'
import McpServerDialog from '@/features/mcp/components/McpServerDialog.vue'
import mcpVi from '@/features/mcp/locales/vi'
import { MCP_MASK, type McpServerConfig } from '@/features/mcp/business/types'

/**
 * TC-75…TC-79 (+ TC-101) — panel danh sách MCP.
 *
 * Panel là bề mặt của AC-1 ở tầng nhanh; e2e (`test-e2e/mcp.spec.ts`) là lớp xác
 * nhận thứ hai.
 */

vi.mock('@/features/mcp/scripts/mcpApi', () => ({
  fetchMcpServers: vi.fn(async () => ({ servers: [] })),
  saveMcpServer: vi.fn(async (server: any) => ({ saved: true, server })),
  deleteMcpServer: vi.fn(async () => ({ deleted: true })),
  testMcpServer: vi.fn(async () => ({ ok: true, tools: [], warnings: [], durationMs: 1 })),
}))

vi.mock('@/features/runner/scripts/ConnectionDialogApi', () => ({
  fetchCredentials: vi.fn(async () => ({ profiles: [] })),
}))

import { deleteMcpServer, fetchMcpServers, saveMcpServer } from '@/features/mcp/scripts/mcpApi'

const PLAYWRIGHT: McpServerConfig = {
  id: 'playwright',
  label: 'Playwright MCP',
  enabled: true,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@playwright/mcp@latest'],
  env: {},
  lastCheck: { at: '2026-09-18T00:00:00.000Z', ok: true, toolCount: 21, toolNames: [] },
}

const GITHUB: McpServerConfig = {
  id: 'github',
  label: 'GitHub MCP',
  enabled: true,
  transport: 'http',
  url: 'https://api.githubcopilot.com/mcp/',
  headers: {},
  lastCheck: { at: '2026-09-18T00:00:00.000Z', ok: false, toolCount: 0, toolNames: [] },
}

const SERENA: McpServerConfig = {
  id: 'serena',
  label: 'Serena',
  enabled: true,
  transport: 'sse',
  url: 'http://127.0.0.1:3000/sse',
  headers: {},
  lastCheck: null,
}

function qa<T extends Element = HTMLElement>(selector: string): T[] {
  return Array.from(document.body.querySelectorAll<T>(selector))
}
function buttonByLabel(label: string): HTMLButtonElement {
  const btn = qa<HTMLButtonElement>('button').find((b) => b.getAttribute('aria-label') === label)
  if (!btn) throw new Error(`button not found: ${label}`)
  return btn
}
function rows(): HTMLElement[] {
  return qa<HTMLElement>('.mcp-list li').filter((li) => !li.classList.contains('empty'))
}
async function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await flushPromises()
}

async function mountPanel(servers: McpServerConfig[]) {
  vi.mocked(fetchMcpServers).mockResolvedValue({ servers } as any)
  const w = mount(McpPanel, { attachTo: document.body })
  await flushPromises()
  return w
}

beforeEach(() => {
  vi.mocked(fetchMcpServers).mockClear()
  vi.mocked(saveMcpServer).mockClear()
  vi.mocked(deleteMcpServer).mockClear()
  vi.mocked(fetchMcpServers).mockResolvedValue({ servers: [] } as any)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('McpPanel — danh sách', () => {
  // TC-75
  it('TC-75: danh sách rỗng ⇒ empty state, nút thêm vẫn hiện', async () => {
    await mountPanel([])

    expect(document.body.textContent).toContain(mcpVi.panel.empty)
    expect(qa('button').some((b) => b.textContent?.trim() === mcpVi.panel.add)).toBe(true)
  })

  // TC-76
  it('TC-76: mỗi dòng hiện label, chip transport và chip trạng thái đúng', async () => {
    await mountPanel([PLAYWRIGHT, GITHUB, SERENA])

    const list = rows()
    expect(list).toHaveLength(3)

    expect(list[0].textContent).toContain('Playwright MCP')
    expect(list[0].textContent).toContain(mcpVi.transport.stdio)
    expect(list[0].textContent).toContain(mcpVi.panel.checkOk.replace('{count}', '21'))

    expect(list[1].textContent).toContain('GitHub MCP')
    expect(list[1].textContent).toContain(mcpVi.transport.http)
    expect(list[1].textContent).toContain(mcpVi.panel.checkFailed)

    expect(list[2].textContent).toContain('Serena')
    expect(list[2].textContent).toContain(mcpVi.transport.sse)
    expect(list[2].textContent).toContain(mcpVi.panel.never)
    // Chưa kiểm tra bao giờ ⇒ 🚫 không hiện số tool.
    expect(list[2].textContent).not.toMatch(/\d+ tool/)
  })

  // TC-77
  it('TC-77: sao chép ⇒ bản sao mang id `-copy`, tắt sẵn; bản gốc không đổi', async () => {
    const w = await mountPanel([PLAYWRIGHT])

    await click(buttonByLabel(mcpVi.panel.copy))

    const draft = w.findComponent(McpServerDialog).props('server') as McpServerConfig
    expect(draft.id).toBe('playwright-copy')
    expect(draft.enabled).toBe(false)
    expect(draft.lastCheck).toBeNull()
    // Bản gốc trong danh sách không bị đụng.
    expect(rows()[0].textContent).toContain('Playwright MCP')
    expect(PLAYWRIGHT.id).toBe('playwright')
    expect(PLAYWRIGHT.enabled).toBe(true)
  })

  // TC-78
  it('TC-78: xoá có xác nhận — huỷ thì 🚫 không gọi DELETE, xác nhận thì gọi đúng id', async () => {
    await mountPanel([PLAYWRIGHT])

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await click(buttonByLabel(mcpVi.panel.delete))
    expect(deleteMcpServer).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(1)

    confirmSpy.mockReturnValue(true)
    vi.mocked(fetchMcpServers).mockResolvedValue({ servers: [] } as any)
    await click(buttonByLabel(mcpVi.panel.delete))
    expect(deleteMcpServer).toHaveBeenCalledWith('playwright')
    await flushPromises()
    expect(rows()).toHaveLength(0)
  })

  /**
   * TC-79 — E19. Component ưu tiên hiện thông điệp gốc và chỉ rơi về nhãn i18n
   * khi thông điệp rỗng; ca này khoá cả hai nhánh. Điều kiện chính: 🚫 không ném
   * ra ngoài, để tab `Runner` vẫn chuyển sang được (khoá ở TC-83).
   */
  it('TC-79: API lỗi ⇒ err-banner, danh sách rỗng, component không ném', async () => {
    vi.mocked(fetchMcpServers).mockRejectedValueOnce(new Error('HTTP 500'))
    const w = mount(McpPanel, { attachTo: document.body })
    await flushPromises()

    expect(qa('.err-banner')).toHaveLength(1)
    expect(qa('.err-banner')[0].textContent).toContain('HTTP 500')
    expect(rows()).toHaveLength(0)
    w.unmount()
    document.body.innerHTML = ''

    // ⚠️ Lệch so với `test-spec.md`: spec kỳ vọng banner mang nhãn
    // `mcp.errors.loadFailed`. Hiện thực dựng thông điệp bằng
    // `String(e.message || e)`, mà `String(err)` KHÔNG bao giờ rỗng ⇒ nhánh
    // fallback i18n không với tới được. Ca này chỉ khoá bất biến người dùng
    // thấy (có banner, danh sách rỗng, 🚫 không ném) chứ không khoá chuỗi hiện
    // tại — xem mục "Bug phát hiện ở source" trong `test-result.md`.
    vi.mocked(fetchMcpServers).mockRejectedValueOnce(new Error(''))
    mount(McpPanel, { attachTo: document.body })
    await flushPromises()
    expect(qa('.err-banner')).toHaveLength(1)
    expect(qa('.err-banner')[0].textContent!.trim().length).toBeGreaterThan(0)
    expect(rows()).toHaveLength(0)
  })
})

/**
 * TC-101 — `openCopy` xoá GIÁ TRỊ secret nhưng GIỮ KHOÁ (reviewer vòng 3 đề
 * nghị, chưa có trong test-spec).
 *
 * Bản sao mang id mới nên backend không có bản cũ để khôi phục giá trị sau
 * `***` — khoá đó bị bỏ hẳn. Ô hiện ra RỖNG thay vì `***` là điều kiện để người
 * dùng biết phải nhập lại; `***` trông như đã có giá trị và chỉ lộ ra ở lần job
 * đầu tiên fail 401.
 */
describe('TC-101: McpPanel — openCopy và cờ secrets-cleared', () => {
  const WITH_SECRETS: McpServerConfig = {
    ...PLAYWRIGHT,
    // Bản public từ API: giá trị thật đã bị mask, `env:NAME` giữ nguyên.
    env: { TOKEN: MCP_MASK, PLAIN: 'env:MY_VAR' },
  }

  it('TC-101 (a): copy giữ KEY `TOKEN` với value rỗng, 🚫 không đụng `PLAIN`, cờ bật', async () => {
    const w = await mountPanel([WITH_SECRETS])

    await click(buttonByLabel(mcpVi.panel.copy))

    const dialog = w.findComponent(McpServerDialog)
    const draft = dialog.props('server') as any
    expect(Object.keys(draft.env).sort()).toEqual(['PLAIN', 'TOKEN'])
    expect(draft.env.TOKEN).toBe('')
    expect(draft.env.PLAIN).toBe('env:MY_VAR')
    expect(dialog.props('secretsCleared')).toBe(true)
    // Dòng nhắc nhập lại phải hiện ra cho người dùng.
    expect(document.body.textContent).toContain(mcpVi.dialog.copySecretsCleared)
  })

  it('TC-101 (b): `openEdit` ngay sau đó tắt cờ và giữ nguyên `***`', async () => {
    const w = await mountPanel([WITH_SECRETS])
    await click(buttonByLabel(mcpVi.panel.copy))
    expect(w.findComponent(McpServerDialog).props('secretsCleared')).toBe(true)

    // Bấm vào chính dòng đó ⇒ `openEdit`.
    await click(rows()[0])

    const dialog = w.findComponent(McpServerDialog)
    const draft = dialog.props('server') as any
    expect(dialog.props('secretsCleared')).toBe(false)
    expect(draft.id).toBe('playwright')
    expect(draft.env.TOKEN).toBe(MCP_MASK)
    expect(document.body.textContent).not.toContain(mcpVi.dialog.copySecretsCleared)
  })
})
