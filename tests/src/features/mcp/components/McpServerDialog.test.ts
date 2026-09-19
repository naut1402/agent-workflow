import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount } from '../../../helpers/i18n'
import McpServerDialog from '@/features/mcp/components/McpServerDialog.vue'
import mcpVi from '@/features/mcp/locales/vi'
import {
  MCP_DEFAULT_TIMEOUT_MS,
  looksLikeSecretLiteral,
} from '@/features/mcp/business/types'

/**
 * TC-65…TC-74 — dialog khai báo MCP server.
 *
 * Dialog render qua `<Teleport to="body">`, nên mọi truy vấn DOM đi thẳng
 * `document.body` (wrapper chỉ thấy mount anchor) — cùng quy ước với
 * `ConnectionDialog.test.ts`.
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

import { saveMcpServer, testMcpServer } from '@/features/mcp/scripts/mcpApi'
import { fetchCredentials } from '@/features/runner/scripts/ConnectionDialogApi'

const CREDENTIALS = [{ id: 'cred-1', label: 'GitHub MCP token' }]

function qa<T extends Element = HTMLElement>(selector: string): T[] {
  return Array.from(document.body.querySelectorAll<T>(selector))
}
function buttonByText(text: string): HTMLButtonElement {
  const btn = qa<HTMLButtonElement>('button').find((b) => b.textContent?.trim() === text)
  if (!btn) throw new Error(`button not found: ${text}`)
  return btn
}
/** Ô nhập nằm trong `<label class="cfg-label">Nhãn <input/></label>`. */
function inputByLabel(label: string): HTMLInputElement {
  const el = qa<HTMLLabelElement>('label.cfg-label').find((l) => l.textContent?.trim().startsWith(label))
  const input = el?.querySelector('input')
  if (!input) throw new Error(`input not found for label: ${label}`)
  return input as HTMLInputElement
}
function hasLabel(label: string): boolean {
  return qa<HTMLElement>('.cfg-label').some((l) => l.textContent?.trim().startsWith(label))
}
/**
 * `dispatchEvent` chứ 🚫 không `HTMLElement.click()`: các `CSelect` của dialog
 * nằm TRONG `<label class="cfg-label">`, và `click()` kích hoạt label-forwarding
 * của jsdom — click vào `<li>` chọn option sẽ dội ngược thành click lên
 * `.c-select-trigger` và mở lại menu. Cùng quy ước với `ConnectionDialog.test.ts`.
 */
async function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await flushPromises()
}
/** Click "thật" — jsdom tôn trọng `disabled`. Dùng cho ca bấm vào nút đang tắt. */
async function nativeClick(el: Element) {
  ;(el as HTMLElement).click()
  await flushPromises()
}
async function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}
function cSelectRoot(ariaLabel: string): HTMLElement {
  const el = qa<HTMLElement>('.c-select').find(
    (root) => root.querySelector('.c-select-trigger')?.getAttribute('aria-label') === ariaLabel,
  )
  if (!el) throw new Error(`CSelect not found: ${ariaLabel}`)
  return el
}
/**
 * Mở menu rồi chọn option theo nhãn.
 *
 * ⚠️ Chỉ bấm trigger khi menu đang ĐÓNG: `CSelect` nằm trong `<label>`, nên click
 * chọn option dội qua label-forwarding của jsdom và mở lại menu. Bấm trigger vô
 * điều kiện ở lượt sau sẽ ĐÓNG menu và không tìm thấy option nào.
 */
async function pickOption(ariaLabel: string, optionLabel: string) {
  const root = cSelectRoot(ariaLabel)
  if (!root.querySelector('.c-select-menu')) {
    await click(root.querySelector('.c-select-trigger')!)
  }
  const option = Array.from(root.querySelectorAll<HTMLLIElement>('.c-select-option')).find(
    (li) => li.textContent?.trim() === optionLabel,
  )
  if (!option) throw new Error(`option not found: ${optionLabel}`)
  await click(option)
}
async function chooseTransport(kind: 'stdio' | 'http' | 'sse') {
  await pickOption(mcpVi.dialog.transportField, mcpVi.transport[kind])
}

async function mountDialog(props: Record<string, unknown> = {}) {
  const w = mount(McpServerDialog, { props, attachTo: document.body })
  await flushPromises()
  return w
}

beforeEach(() => {
  vi.mocked(saveMcpServer).mockClear()
  vi.mocked(testMcpServer).mockClear()
  vi.mocked(fetchCredentials).mockClear()
  vi.mocked(fetchCredentials).mockResolvedValue({ profiles: [...CREDENTIALS] } as any)
  vi.mocked(testMcpServer).mockResolvedValue({ ok: true, tools: [], warnings: [], durationMs: 1 } as any)
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('McpServerDialog — trạng thái và bộ input theo transport', () => {
  // TC-65
  it('TC-65: dialog mới mặc định stdio, timeout mặc định, enabled bật', async () => {
    await mountDialog()

    expect(cSelectRoot(mcpVi.dialog.transportField).querySelector('.c-select-value')!.textContent!.trim())
      .toBe(mcpVi.transport.stdio)
    expect(inputByLabel(mcpVi.dialog.timeoutField).value).toBe(String(MCP_DEFAULT_TIMEOUT_MS))
    expect(inputByLabel(mcpVi.dialog.enabledField).checked).toBe(true)

    for (const label of [mcpVi.dialog.commandField, mcpVi.dialog.argsField, mcpVi.dialog.envField, mcpVi.dialog.cwdField]) {
      expect(hasLabel(label)).toBe(true)
    }
    for (const label of [mcpVi.dialog.urlField, mcpVi.dialog.credentialField, mcpVi.dialog.headersField]) {
      expect(hasLabel(label)).toBe(false)
    }
  })

  // TC-66
  it('TC-66: đổi transport ⇒ đổi bộ input hiển thị; id/label/enabled/timeout hiện ở cả ba', async () => {
    await mountDialog()

    for (const kind of ['http', 'sse'] as const) {
      await chooseTransport(kind)
      for (const label of [
        mcpVi.dialog.urlField,
        mcpVi.dialog.credentialField,
        mcpVi.dialog.authHeaderField,
        mcpVi.dialog.authSchemeField,
        mcpVi.dialog.headersField,
      ]) {
        expect(hasLabel(label)).toBe(true)
      }
      for (const label of [mcpVi.dialog.commandField, mcpVi.dialog.argsField, mcpVi.dialog.envField, mcpVi.dialog.cwdField]) {
        expect(hasLabel(label)).toBe(false)
      }
      for (const label of [mcpVi.dialog.idField, mcpVi.dialog.labelField, mcpVi.dialog.enabledField, mcpVi.dialog.timeoutField]) {
        expect(hasLabel(label)).toBe(true)
      }
    }

    await chooseTransport('stdio')
    expect(hasLabel(mcpVi.dialog.commandField)).toBe(true)
    expect(hasLabel(mcpVi.dialog.urlField)).toBe(false)
  })

  // TC-67
  it('TC-67: gợi ý URL theo convention giao thức', async () => {
    await mountDialog()

    // (a) url rỗng + chọn http ⇒ điền gợi ý mặc định.
    await chooseTransport('http')
    expect(inputByLabel(mcpVi.dialog.urlField).value).toBe('http://127.0.0.1:3000/mcp')

    // (c) đuôi `/mcp` + chọn sse ⇒ đổi đuôi, giữ host/port.
    await chooseTransport('sse')
    expect(inputByLabel(mcpVi.dialog.urlField).value).toBe('http://127.0.0.1:3000/sse')

    // (b) đuôi `/sse` + chọn http ⇒ đổi lại đuôi `/mcp`.
    await chooseTransport('http')
    expect(inputByLabel(mcpVi.dialog.urlField).value).toBe('http://127.0.0.1:3000/mcp')
  })

  // TC-68
  it('TC-68: URL người dùng tự gõ không bị ghi đè', async () => {
    await mountDialog()
    await chooseTransport('http')
    await setValue(inputByLabel(mcpVi.dialog.urlField), 'https://api.example.com/v1/custom')

    await chooseTransport('sse')
    expect(inputByLabel(mcpVi.dialog.urlField).value).toBe('https://api.example.com/v1/custom')
    await chooseTransport('http')
    expect(inputByLabel(mcpVi.dialog.urlField).value).toBe('https://api.example.com/v1/custom')
  })

  // TC-69
  it('TC-69: đổi transport không mất dữ liệu đã gõ', async () => {
    await mountDialog()
    await setValue(inputByLabel(mcpVi.dialog.commandField), 'npx')

    await chooseTransport('http')
    await chooseTransport('stdio')

    expect(inputByLabel(mcpVi.dialog.commandField).value).toBe('npx')
  })

  // TC-70
  it('TC-70: payload lưu chỉ mang trường của transport đang chọn', async () => {
    await mountDialog()
    await setValue(inputByLabel(mcpVi.dialog.idField), 'gh')
    await setValue(inputByLabel(mcpVi.dialog.commandField), 'npx')
    await chooseTransport('http')
    await setValue(inputByLabel(mcpVi.dialog.urlField), 'https://api.example.com/mcp')
    await click(buttonByText(mcpVi.dialog.save))

    const remote = vi.mocked(saveMcpServer).mock.calls[0][0] as any
    expect(remote.transport).toBe('http')
    expect(remote.url).toBe('https://api.example.com/mcp')
    expect(remote).not.toHaveProperty('command')
    expect(remote).not.toHaveProperty('args')
    expect(remote).not.toHaveProperty('cwd')

    await chooseTransport('stdio')
    await click(buttonByText(mcpVi.dialog.save))

    const stdio = vi.mocked(saveMcpServer).mock.calls[1][0] as any
    expect(stdio.transport).toBe('stdio')
    expect(stdio.command).toBe('npx')
    expect(stdio).not.toHaveProperty('url')
    expect(stdio).not.toHaveProperty('headers')
  })
})

describe('McpServerDialog — credential và kiểm tra kết nối', () => {
  // TC-71
  it('TC-71 (a): chọn credential khi hai ô đang rỗng ⇒ điền mặc định Authorization/Bearer', async () => {
    await mountDialog()
    await chooseTransport('http')

    await pickOption(mcpVi.dialog.credentialField, 'GitHub MCP token')

    expect(inputByLabel(mcpVi.dialog.authHeaderField).value).toBe('Authorization')
    expect(inputByLabel(mcpVi.dialog.authSchemeField).value).toBe('Bearer')
  })

  it('TC-71 (b): authHeader người dùng đã gõ 🚫 không bị ghi đè', async () => {
    await mountDialog()
    await chooseTransport('http')
    await setValue(inputByLabel(mcpVi.dialog.authHeaderField), 'X-Api-Key')

    await pickOption(mcpVi.dialog.credentialField, 'GitHub MCP token')

    expect(inputByLabel(mcpVi.dialog.authHeaderField).value).toBe('X-Api-Key')
    expect(inputByLabel(mcpVi.dialog.authSchemeField).value).toBe('Bearer')
  })

  // TC-72
  it('TC-72: nút «Lấy danh sách tool» chỉ bật sau khi kiểm tra OK, tắt lại khi sửa cấu hình', async () => {
    await mountDialog()
    await setValue(inputByLabel(mcpVi.dialog.idField), 'gh')
    await chooseTransport('http')

    // (a) vừa mở dialog / chưa kiểm tra.
    expect(buttonByText(mcpVi.dialog.listTools).disabled).toBe(true)

    // (b) kiểm tra thất bại ⇒ vẫn tắt.
    vi.mocked(testMcpServer).mockResolvedValueOnce({ ok: false, tools: [], warnings: [], durationMs: 1, error: 'nope' } as any)
    await click(buttonByText(mcpVi.dialog.test))
    expect(buttonByText(mcpVi.dialog.listTools).disabled).toBe(true)

    // (c) kiểm tra OK ⇒ bật.
    await click(buttonByText(mcpVi.dialog.test))
    expect(buttonByText(mcpVi.dialog.listTools).disabled).toBe(false)

    // (d) sửa cấu hình ⇒ kết quả cũ hết hiệu lực (§6.6 Q2).
    await setValue(inputByLabel(mcpVi.dialog.urlField), 'http://127.0.0.1:9999/mcp')
    expect(buttonByText(mcpVi.dialog.listTools).disabled).toBe(true)
  })

  // TC-73
  it('TC-73: đang chạy ⇒ nút tắt + chỉ báo, bấm tiếp 🚫 không gửi request thứ hai; lỗi hiện nguyên văn', async () => {
    let resolveProbe: (v: any) => void = () => {}
    vi.mocked(testMcpServer).mockImplementationOnce(
      () => new Promise((resolve) => { resolveProbe = resolve }),
    )

    await mountDialog()
    await setValue(inputByLabel(mcpVi.dialog.idField), 'gh')
    await setValue(inputByLabel(mcpVi.dialog.commandField), 'npx')

    await click(buttonByText(mcpVi.dialog.test))
    // Đang pending: nhãn đổi sang chỉ báo, nút tắt.
    const pendingBtn = buttonByText(mcpVi.dialog.testing)
    expect(pendingBtn.disabled).toBe(true)

    await nativeClick(pendingBtn)
    expect(testMcpServer).toHaveBeenCalledTimes(1)

    resolveProbe({ ok: false, tools: [], warnings: [], durationMs: 3, error: 'ECONNREFUSED 127.0.0.1:8931' })
    await flushPromises()

    // Thông điệp gốc là thứ duy nhất người dùng có để sửa cấu hình.
    expect(document.body.textContent).toContain('ECONNREFUSED 127.0.0.1:8931')
  })
})

describe('McpServerDialog — cảnh báo secret literal', () => {
  async function addEnvRow(key: string, value: string) {
    await click(buttonByText(mcpVi.dialog.addRow))
    const rows = qa<HTMLElement>('.kv-row').filter(
      (r) => r.querySelector(`input[placeholder="${mcpVi.dialog.keyPlaceholder}"]`),
    )
    const row = rows[rows.length - 1]
    await setValue(row.querySelector<HTMLInputElement>(`input[placeholder="${mcpVi.dialog.keyPlaceholder}"]`)!, key)
    await setValue(row.querySelector<HTMLInputElement>(`input[placeholder="${mcpVi.dialog.valuePlaceholder}"]`)!, value)
  }

  function warningShown(): boolean {
    return document.body.textContent!.includes(mcpVi.dialog.secretLiteralWarning)
  }

  // TC-74 — E16. Biên: key khớp `authorization|token|key|secret|password` (không
  // phân biệt hoa thường) VÀ độ dài ≥ 20.
  const cases: { name: string; key: string; value: string; warn: boolean }[] = [
    { name: '(a) Authorization + 20 ký tự', key: 'Authorization', value: 'a'.repeat(20), warn: true },
    { name: '(b) Authorization + 19 ký tự — cạnh dưới', key: 'Authorization', value: 'a'.repeat(19), warn: false },
    { name: '(c) X-Trace + 40 ký tự — key không giống secret', key: 'X-Trace', value: 'a'.repeat(40), warn: false },
    { name: '(d) api_token + 25 ký tự', key: 'api_token', value: 'a'.repeat(25), warn: true },
    { name: '(e) SECRET viết hoa + 25 ký tự', key: 'SECRET', value: 'a'.repeat(25), warn: true },
  ]

  for (const c of cases) {
    it(`TC-74 ${c.name} ⇒ ${c.warn ? 'cảnh báo' : 'không cảnh báo'}, và vẫn lưu được`, async () => {
      await mountDialog()
      await setValue(inputByLabel(mcpVi.dialog.idField), 'gh')
      await setValue(inputByLabel(mcpVi.dialog.commandField), 'npx')
      await addEnvRow(c.key, c.value)

      expect(warningShown()).toBe(c.warn)
      // Ngưỡng là hàm dùng chung — 🚫 không chép luật vào test.
      expect(looksLikeSecretLiteral(c.key, c.value)).toBe(c.warn)

      // 🚫 Không chặn cứng: mọi ca vẫn lưu được.
      await click(buttonByText(mcpVi.dialog.save))
      expect(saveMcpServer).toHaveBeenCalledTimes(1)
      expect((vi.mocked(saveMcpServer).mock.calls[0][0] as any).env[c.key]).toBe(c.value)
    })
  }
})
