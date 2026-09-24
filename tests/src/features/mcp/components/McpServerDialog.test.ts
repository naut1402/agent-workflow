import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createTestI18nPlugin } from '../../../helpers/i18n'
import { mount } from '@vue/test-utils'
import McpServerDialog from '@/features/mcp/components/McpServerDialog.vue'
import CSelect from '@/frontend/ui/CSelect.vue'
import mcpVi from '@/features/mcp/locales/vi'
import mcpEn from '@/features/mcp/locales/en'
import {
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MASK,
  MCP_MIN_TIMEOUT_MS,
  looksLikeSecretLiteral,
  sanitiseMcpServerId,
} from '@/features/mcp/business/types'

/**
 * TC-65…TC-74 (khai báo MCP server) + TC-A01…TC-A22 · TC-B01/B02/B11 ·
 * TC-G03…TC-G09 của task Tdad47b2b (id nội suy từ Tên hiển thị, select tự đóng).
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
/**
 * Nhãn trường. Markup có HAI dạng và helper phải chịu được cả hai:
 *   - `<label class="cfg-label">Nhãn<input/></label>` (ô nhập bọc trong nhãn);
 *   - `<span class="cfg-label">Nhãn</span>` + ô nhập/CSelect là anh em trong
 *     cùng `.field` / `.timeout-field` — dạng dùng cho trường có `CSelect` hoặc
 *     có `InfoTooltip`, vì `<label>` bọc CSelect gây lỗi label-forwarding.
 * Dấu `*` bắt buộc nằm TRONG nhãn nên so khớp bằng `startsWith`.
 */
function labelNode(label: string): HTMLElement | undefined {
  return qa<HTMLElement>('.cfg-label').find((l) => l.textContent?.trim().startsWith(label))
}
function inputByLabel(label: string): HTMLInputElement {
  const el = labelNode(label)
  const input = el?.querySelector('input') ?? el?.parentElement?.querySelector('input')
  if (!input) throw new Error(`input not found for label: ${label}`)
  return input as HTMLInputElement
}
function hasLabel(label: string): boolean {
  return Boolean(labelNode(label))
}
/** Dòng `Id: …` chỉ-đọc dưới ô Tên hiển thị. `null` khi dòng không hiện. */
function idHint(): string | null {
  const el = document.body.querySelector('.id-hint')
  return el ? el.textContent!.trim() : null
}
function expectedIdHint(id: string, dict: typeof mcpVi = mcpVi): string {
  return dict.dialog.idDerived.replace('{id}', id)
}
/** Id đang hiện trên dòng preview, đã bóc phần nhãn i18n. */
function shownId(): string | null {
  const raw = idHint()
  if (raw === null) return null
  const [prefix] = mcpVi.dialog.idDerived.split('{id}')
  return raw.slice(prefix.length).trim()
}

/**
 * Click THẬT (`HTMLElement.click()`). Sau khi `CSelect` chặn label-forwarding
 * bằng `@click.prevent` (task Tdad47b2b) thì 🚫 không còn workaround
 * `dispatchEvent` nào ở đây — dùng `dispatchEvent` là né đúng đường đang cần phủ.
 */
async function click(el: Element) {
  ;(el as HTMLElement).click()
  await flushPromises()
}
/**
 * `onClickOutside` của `@vueuse` nhả cờ `isProcessingClick` bằng `setTimeout(0)`;
 * cú click mở menu bật cờ đó nên click kế tiếp bị nuốt nếu chưa nhả timer.
 * Chi tiết của thư viện, 🚫 không phải hành vi sản phẩm.
 */
const settleClickGuard = () => new Promise((r) => setTimeout(r, 0))

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
function menuOpen(ariaLabel: string): boolean {
  return Boolean(cSelectRoot(ariaLabel).querySelector('.c-select-menu'))
}
async function openSelect(ariaLabel: string) {
  await click(cSelectRoot(ariaLabel).querySelector('.c-select-trigger')!)
  await settleClickGuard()
}
/** Mở menu rồi chọn option theo nhãn — bấm trigger vô điều kiện, menu luôn đóng sau khi chọn. */
async function pickOption(ariaLabel: string, optionLabel: string) {
  const root = cSelectRoot(ariaLabel)
  await openSelect(ariaLabel)
  const option = Array.from(root.querySelectorAll<HTMLLIElement>('.c-select-option')).find(
    (li) => li.textContent?.trim() === optionLabel,
  )
  if (!option) throw new Error(`option not found: ${optionLabel}`)
  await click(option)
}
async function chooseTransport(kind: 'stdio' | 'http' | 'sse') {
  await pickOption(mcpVi.dialog.transportField, mcpVi.transport[kind])
}

async function mountDialog(props: Record<string, unknown> = {}, locale: 'vi' | 'en' = 'vi') {
  const w = mount(McpServerDialog, {
    props,
    attachTo: document.body,
    global: { plugins: [createTestI18nPlugin(locale)] },
  })
  await flushPromises()
  return w
}

/** Bản nháp stdio tối thiểu để `buildDraft()` qua được (command là trường bắt buộc). */
async function fillMinimalStdio(label: string) {
  await setValue(inputByLabel(mcpVi.dialog.labelField), label)
  await setValue(inputByLabel(mcpVi.dialog.commandField), 'npx')
}

function savedPayload(index = 0): any {
  return vi.mocked(saveMcpServer).mock.calls[index][0] as any
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
  // TC-65 · TC-G04
  it('TC-65: dialog mới mặc định stdio, timeout mặc định, enabled bật', async () => {
    await mountDialog()

    expect(cSelectRoot(mcpVi.dialog.transportField).querySelector('.c-select-value')!.textContent!.trim())
      .toBe(mcpVi.transport.stdio)
    // TC-G04: đọc từ hằng dùng chung, 🚫 không hardcode con số trong test.
    expect(inputByLabel(mcpVi.dialog.timeoutField).value).toBe(String(MCP_DEFAULT_TIMEOUT_MS))
    expect(inputByLabel(mcpVi.dialog.enabledField).checked).toBe(true)

    for (const label of [mcpVi.dialog.commandField, mcpVi.dialog.argsField, mcpVi.dialog.envField, mcpVi.dialog.cwdField]) {
      expect(hasLabel(label)).toBe(true)
    }
    for (const label of [mcpVi.dialog.urlField, mcpVi.dialog.credentialField, mcpVi.dialog.headersField]) {
      expect(hasLabel(label)).toBe(false)
    }
  })

  // TC-66 — ⚠️ danh sách nhãn chung 🚫 KHÔNG còn `idField`: ô Id đã bị bỏ (TC-A01).
  it('TC-66: đổi transport ⇒ đổi bộ input hiển thị; label/enabled/timeout hiện ở cả ba', async () => {
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
      for (const label of [mcpVi.dialog.labelField, mcpVi.dialog.enabledField, mcpVi.dialog.timeoutField]) {
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
    await fillMinimalStdio('gh')
    await chooseTransport('http')
    await setValue(inputByLabel(mcpVi.dialog.urlField), 'https://api.example.com/mcp')
    await click(buttonByText(mcpVi.dialog.save))

    const remote = savedPayload(0)
    expect(remote.transport).toBe('http')
    expect(remote.url).toBe('https://api.example.com/mcp')
    expect(remote).not.toHaveProperty('command')
    expect(remote).not.toHaveProperty('args')
    expect(remote).not.toHaveProperty('cwd')

    await chooseTransport('stdio')
    await click(buttonByText(mcpVi.dialog.save))

    const stdio = savedPayload(1)
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
    await setValue(inputByLabel(mcpVi.dialog.labelField), 'gh')
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
    await fillMinimalStdio('gh')

    await click(buttonByText(mcpVi.dialog.test))
    // Đang pending: nhãn đổi sang chỉ báo, nút tắt.
    const pendingBtn = buttonByText(mcpVi.dialog.testing)
    expect(pendingBtn.disabled).toBe(true)

    // jsdom tôn trọng `disabled`: click thật vào nút đang tắt không kích handler.
    await click(pendingBtn)
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
      await fillMinimalStdio('gh')
      await addEnvRow(c.key, c.value)

      expect(warningShown()).toBe(c.warn)
      // Ngưỡng là hàm dùng chung — 🚫 không chép luật vào test.
      expect(looksLikeSecretLiteral(c.key, c.value)).toBe(c.warn)

      // 🚫 Không chặn cứng: mọi ca vẫn lưu được.
      await click(buttonByText(mcpVi.dialog.save))
      expect(saveMcpServer).toHaveBeenCalledTimes(1)
      expect(savedPayload().env[c.key]).toBe(c.value)
    })
  }
})

/* ─── Tdad47b2b · nhóm A — id nội suy từ Tên hiển thị ─────────────────────── */

describe('McpServerDialog — id nội suy từ Tên hiển thị (nhóm A)', () => {
  // TC-A01
  it('TC-A01: 🚫 không còn ô nhập Id; ô nhập đầu tiên là Tên hiển thị và có dấu bắt buộc', async () => {
    await mountDialog()

    // Không nhãn trường `Id`, không placeholder cũ, không thông báo chuẩn hoá id.
    expect(qa<HTMLElement>('.cfg-label').some((l) => l.textContent?.trim() === 'Id')).toBe(false)
    expect(qa<HTMLInputElement>('input[placeholder]').map((i) => i.placeholder)).not.toContain('vd. playwright')
    expect(document.body.textContent).not.toContain('sẽ được lưu thành')

    const firstText = qa<HTMLInputElement>('.modal-body input').filter((i) => i.type !== 'checkbox')[0]
    expect(firstText).toBe(inputByLabel(mcpVi.dialog.labelField))

    const req = labelNode(mcpVi.dialog.labelField)!.querySelector('.req')!
    expect(req.textContent).toBe('*')
    // Dòng preview chỉ hiện khi đã có tên.
    expect(idHint()).toBeNull()
  })

  // TC-A02
  it('TC-A02: preview id cập nhật theo từng ký tự, 🚫 không cần blur/submit', async () => {
    await mountDialog()
    const input = inputByLabel(mcpVi.dialog.labelField)

    await setValue(input, 'Play')
    expect(idHint()).toBe(expectedIdHint('play'))

    await setValue(input, 'Playwright MCP')
    expect(idHint()).toBe(expectedIdHint('playwright-mcp'))

    await setValue(input, 'Playwright MC')
    expect(idHint()).toBe(expectedIdHint('playwright-mc'))
  })

  // TC-A03
  it('TC-A03: id hiện trên màn = id đi vào request lưu', async () => {
    await mountDialog()
    await fillMinimalStdio('Playwright MCP')
    const preview = shownId()

    await click(buttonByText(mcpVi.dialog.save))

    expect(saveMcpServer).toHaveBeenCalledTimes(1)
    expect(savedPayload().id).toBe('playwright-mcp')
    expect(savedPayload().id).toBe(preview)
    expect(savedPayload().label).toBe('Playwright MCP')
  })

  // TC-A04
  it('TC-A04: request probe mang CÙNG id với request lưu', async () => {
    await mountDialog()
    await fillMinimalStdio('Playwright MCP')

    await click(buttonByText(mcpVi.dialog.test))
    await click(buttonByText(mcpVi.dialog.save))

    const probed = vi.mocked(testMcpServer).mock.calls[0][0] as any
    expect(probed.id).toBe(savedPayload().id)
    expect(probed.id).toBe(shownId())
  })

  // TC-A05
  it('TC-A05: Tên hiển thị rỗng / chỉ khoảng trắng ⇒ lỗi, 🚫 không gửi request, 🚫 không preview', async () => {
    for (const value of ['', '   \n\t']) {
      await mountDialog()
      await setValue(inputByLabel(mcpVi.dialog.labelField), value)
      await setValue(inputByLabel(mcpVi.dialog.commandField), 'npx')

      await click(buttonByText(mcpVi.dialog.save))

      expect(qa('.err-banner')[0]?.textContent).toContain(mcpVi.errors.labelRequired)
      expect(saveMcpServer).not.toHaveBeenCalled()
      expect(idHint()).toBeNull()
      document.body.innerHTML = ''
    }
  })

  // TC-A06
  it('TC-A06: bấm Kiểm tra kết nối khi thiếu tên ⇒ cùng lỗi, 🚫 không request probe', async () => {
    await mountDialog()
    await setValue(inputByLabel(mcpVi.dialog.commandField), 'npx')

    await click(buttonByText(mcpVi.dialog.test))

    expect(qa('.err-banner')[0]?.textContent).toContain(mcpVi.errors.labelRequired)
    expect(testMcpServer).not.toHaveBeenCalled()
  })

  // TC-A07
  it('TC-A07: id đã có trong danh sách ⇒ preview và payload mang hậu tố `-2`', async () => {
    await mountDialog({ takenIds: ['playwright-mcp'] })
    await fillMinimalStdio('Playwright MCP')

    expect(idHint()).toBe(expectedIdHint('playwright-mcp-2'))
    await click(buttonByText(mcpVi.dialog.save))
    expect(savedPayload().id).toBe('playwright-mcp-2')
  })

  // TC-A08
  it('TC-A08: trùng nhiều lần ⇒ `-3`', async () => {
    await mountDialog({ takenIds: ['playwright-mcp', 'playwright-mcp-2'] })
    await setValue(inputByLabel(mcpVi.dialog.labelField), 'Playwright MCP')

    expect(idHint()).toBe(expectedIdHint('playwright-mcp-3'))
  })

  // TC-A09
  it('TC-A09: khác hoa/thường và khoảng trắng thừa vẫn tính là trùng', async () => {
    await mountDialog({ takenIds: ['playwright-mcp'] })
    await setValue(inputByLabel(mcpVi.dialog.labelField), 'playwright   MCP')

    expect(shownId()).toBe('playwright-mcp-2')
    expect(shownId()).not.toBe('playwright-mcp')
  })

  // TC-A10
  it('TC-A10: tiếng Việt có dấu ⇒ slug ascii, chỉ `[a-z0-9-]`', async () => {
    await mountDialog()
    await setValue(inputByLabel(mcpVi.dialog.labelField), 'Trợ lý Đa năng')

    expect(shownId()).toBe('tro-ly-da-nang')
    expect(shownId()).toMatch(/^[a-z0-9-]+$/)
  })

  // TC-A11
  it('TC-A11: tên toàn ký tự đặc biệt ⇒ `mcp-server`, trùng thì `mcp-server-2`', async () => {
    for (const raw of ['!!!', '***', '…']) {
      await mountDialog()
      await fillMinimalStdio(raw)
      expect(shownId()).toBe('mcp-server')
      await click(buttonByText(mcpVi.dialog.save))
      expect(savedPayload().id).toBe('mcp-server')
      vi.mocked(saveMcpServer).mockClear()
      document.body.innerHTML = ''
    }

    await mountDialog({ takenIds: ['mcp-server'] })
    await setValue(inputByLabel(mcpVi.dialog.labelField), '!!!')
    expect(shownId()).toBe('mcp-server-2')
  })

  // TC-A12
  it('TC-A12: tên 120 ký tự ⇒ id ≤ 64, 🚫 không đuôi `-`, lưu được', async () => {
    const longLabel = 'ab '.repeat(40).trim() // 119 ký tự chữ thường + khoảng trắng
    await mountDialog()
    await fillMinimalStdio(longLabel)

    const id = shownId()!
    expect(id.length).toBeLessThanOrEqual(64)
    expect(id.endsWith('-')).toBe(false)
    // Điều kiện đủ để backend nhận nguyên văn: id đã ở dạng canonical.
    expect(sanitiseMcpServerId(id)).toBe(id)

    await click(buttonByText(mcpVi.dialog.save))
    expect(savedPayload().id).toBe(id)
  })

  // TC-A13
  it('TC-A13: tên rất dài VÀ trùng ⇒ hậu tố `-2`, `-10`, `-100` đều giữ id ≤ 64 và canonical', async () => {
    const longLabel = 'ab '.repeat(40).trim()

    // (a) base đã bị chiếm ⇒ `-2`.
    await mountDialog()
    await setValue(inputByLabel(mcpVi.dialog.labelField), longLabel)
    const base = shownId()!
    document.body.innerHTML = ''

    for (const upTo of [2, 10, 100]) {
      const taken = [base]
      for (let n = 2; n < upTo; n++) taken.push(...collectSuffixes(base, n))
      await mountDialog({ takenIds: taken })
      await setValue(inputByLabel(mcpVi.dialog.labelField), longLabel)

      const id = shownId()!
      expect(id.endsWith(`-${upTo}`)).toBe(true)
      expect(id.length).toBeLessThanOrEqual(64)
      expect(sanitiseMcpServerId(id)).toBe(id)
      document.body.innerHTML = ''
    }
  })

  // TC-A14
  it('TC-A14: dấu `-` / khoảng trắng thừa hai đầu ⇒ id không mở/đóng bằng `-`, 🚫 không `--`', async () => {
    for (const raw of ['--- Playwright ---', '  Playwright  ']) {
      await mountDialog()
      await setValue(inputByLabel(mcpVi.dialog.labelField), raw)

      const id = shownId()!
      expect(id).toBe('playwright')
      expect(id.startsWith('-')).toBe(false)
      expect(id.endsWith('-')).toBe(false)
      expect(id).not.toContain('--')
      document.body.innerHTML = ''
    }
  })

  // TC-A15
  it('TC-A15: chế độ sửa ⇒ id đóng băng, 🚫 không đổi theo Tên hiển thị', async () => {
    await mountDialog({ server: editableServer() })

    expect(shownId()).toBe('pw')
    await setValue(inputByLabel(mcpVi.dialog.labelField), 'Playwright Mới')
    expect(shownId()).toBe('pw')

    await click(buttonByText(mcpVi.dialog.save))
    expect(savedPayload().id).toBe('pw')
    expect(savedPayload().label).toBe('Playwright Mới')
  })

  // TC-A16
  it('TC-A16: chú thích id ở chế độ tạo và chế độ sửa là hai chuỗi i18n KHÁC nhau', async () => {
    await mountDialog()
    await setValue(inputByLabel(mcpVi.dialog.labelField), 'Playwright MCP')
    const createHint = hintText()
    document.body.innerHTML = ''

    await mountDialog({ server: editableServer() })
    const editHint = hintText()

    expect(createHint).toBe(mcpVi.dialog.idDerivedHint)
    expect(editHint).toBe(mcpVi.dialog.idFrozenHint)
    expect(createHint).not.toBe(editHint)
  })

  // TC-A20
  it('TC-A20: đổi Tên hiển thị sau khi kiểm tra OK ⇒ dấu «đã kiểm tra OK» biến mất', async () => {
    await mountDialog()
    await fillMinimalStdio('Playwright MCP')

    await click(buttonByText(mcpVi.dialog.test))
    expect(buttonByText(mcpVi.dialog.listTools).disabled).toBe(false)

    await setValue(inputByLabel(mcpVi.dialog.labelField), 'Playwright MCP v2')
    expect(buttonByText(mcpVi.dialog.listTools).disabled).toBe(true)
  })

  // TC-A21
  it('TC-A21: caller 🚫 không truyền `takenIds` ⇒ id dạng cơ bản, không lỗi runtime, vẫn lưu được', async () => {
    await mountDialog()
    await fillMinimalStdio('Playwright MCP')

    expect(shownId()).toBe('playwright-mcp')
    await click(buttonByText(mcpVi.dialog.save))
    expect(savedPayload().id).toBe('playwright-mcp')
  })

  /**
   * TC-A22 — chỉ đổi tên thì bí mật đã lưu 🚫 không bị ghi đè.
   *
   * Dialog nhận bản đã mask (`***`) và gửi lại đúng `***`: đó là sentinel «giữ
   * nguyên» mà registry hiểu. Vế còn lại — registry khôi phục giá trị thật — do
   * `registry.test.ts` TC-96 (b) khoá.
   */
  it('TC-A22: sửa tên server có credential ⇒ payload giữ nguyên sentinel `***`', async () => {
    await mountDialog({ server: editableServer({ env: { TOKEN: MCP_MASK, PLAIN: 'env:MY_VAR' } }) })

    await setValue(inputByLabel(mcpVi.dialog.labelField), 'Playwright Mới')
    await click(buttonByText(mcpVi.dialog.save))

    expect(savedPayload().env).toEqual({ TOKEN: MCP_MASK, PLAIN: 'env:MY_VAR' })
  })
})

/* ─── Tdad47b2b · nhóm B — select trong dialog MCP ────────────────────────── */

describe('McpServerDialog — select tự đóng sau khi chọn (nhóm B)', () => {
  // TC-B01
  it('TC-B01: select Transport ⇒ click thật vào option đóng menu, phát đúng một sự kiện', async () => {
    const w = await mountDialog()
    const select = w.findAllComponents(CSelect).find(
      (c) => c.props('ariaLabel') === mcpVi.dialog.transportField,
    )!

    await chooseTransport('http')

    expect(menuOpen(mcpVi.dialog.transportField)).toBe(false)
    expect(cSelectRoot(mcpVi.dialog.transportField).querySelector('.c-select-value')!.textContent!.trim())
      .toBe(mcpVi.transport.http)
    expect(select.emitted('update:modelValue')).toHaveLength(1)
  })

  // TC-B02
  it('TC-B02: select Credential ⇒ như TC-B01', async () => {
    const w = await mountDialog()
    await chooseTransport('http')
    const select = w.findAllComponents(CSelect).find(
      (c) => c.props('ariaLabel') === mcpVi.dialog.credentialField,
    )!

    await pickOption(mcpVi.dialog.credentialField, 'GitHub MCP token')

    expect(menuOpen(mcpVi.dialog.credentialField)).toBe(false)
    expect(cSelectRoot(mcpVi.dialog.credentialField).querySelector('.c-select-value')!.textContent!.trim())
      .toBe('GitHub MCP token')
    expect(select.emitted('update:modelValue')).toHaveLength(1)
  })

  // TC-B11
  it.each(['vi', 'en'] as const)(
    'TC-B11 (%s): hai select vẫn có tên accessible đúng bằng nhãn trường sau khi bỏ <label> bọc',
    async (locale) => {
      const dict = locale === 'vi' ? mcpVi : mcpEn
      await mountDialog({}, locale)
      await pickOption(dict.dialog.transportField, dict.transport.http)

      for (const field of [dict.dialog.transportField, dict.dialog.credentialField]) {
        const trigger = cSelectRoot(field).querySelector('.c-select-trigger')!
        expect(trigger.getAttribute('aria-label')).toBe(field)
      }
    },
  )
})

/* ─── Tdad47b2b · nhóm G — nhãn, a11y, i18n trên dialog ───────────────────── */

describe('McpServerDialog — nhãn và a11y (nhóm G)', () => {
  // TC-G03
  it.each(['vi', 'en'] as const)(
    'TC-G03 (%s): nhãn Timeout nói rõ là timeout KHỞI ĐỘNG và có chú thích phạm vi áp dụng',
    async (locale) => {
      const dict = locale === 'vi' ? mcpVi : mcpEn
      await mountDialog({}, locale)

      expect(hasLabel(dict.dialog.timeoutField)).toBe(true)
      expect(dict.dialog.timeoutField).toMatch(locale === 'vi' ? /khởi động/i : /startup/i)

      const hint = labelNode(dict.dialog.timeoutField)!.querySelector('.info-tooltip-btn')!
      expect(hint.getAttribute('aria-label')).toBe(dict.dialog.timeoutHint)
    },
  )

  // TC-G05
  it('TC-G05: ô Timeout có ràng buộc tối thiểu bằng sàn hợp đồng CLI, 🚫 không còn `min="1"`', async () => {
    await mountDialog()
    const input = inputByLabel(mcpVi.dialog.timeoutField)

    expect(input.getAttribute('min')).toBe(String(MCP_MIN_TIMEOUT_MS))
    expect(input.getAttribute('min')).not.toBe('1')
  })

  // TC-G06
  it('TC-G06: render ở locale `en` ⇒ 🚫 không chuỗi tiếng Việt nào lọt ra', async () => {
    await mountDialog({}, 'en')
    await setValue(inputByLabel(mcpEn.dialog.labelField), 'Playwright MCP')

    expect(idHint()).toBe(expectedIdHint('playwright-mcp', mcpEn as unknown as typeof mcpVi))
    for (const label of [mcpEn.dialog.labelField, mcpEn.dialog.timeoutField, mcpEn.dialog.transportField]) {
      expect(hasLabel(label)).toBe(true)
    }
    // Dấu tiếng Việt là dấu vân tay đủ chắc: 🚫 không ca nào ở đây gõ chuỗi có dấu.
    expect(document.body.textContent).not.toMatch(
      /[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i,
    )
  })

  // TC-G08
  it('TC-G08: dấu `*` bắt buộc ẩn với screen reader; tín hiệu thật là thông điệp lỗi', async () => {
    await mountDialog()
    const req = labelNode(mcpVi.dialog.labelField)!.querySelector('.req')!

    expect(req.getAttribute('aria-hidden')).toBe('true')
    // Nhãn accessible của ô nhập 🚫 không lẫn dấu `*` như một từ riêng.
    expect(labelNode(mcpVi.dialog.labelField)!.textContent!.trim()).toBe(`${mcpVi.dialog.labelField}*`)
  })

  // TC-G09
  it('TC-G09: dòng `Id: …` là text chỉ-đọc, 🚫 không phải trường nhập', async () => {
    await mountDialog()
    await setValue(inputByLabel(mcpVi.dialog.labelField), 'Playwright MCP')

    const line = document.body.querySelector('.id-hint')!
    expect(line.tagName).toBe('P')
    expect(line.querySelectorAll('input, textarea, select')).toHaveLength(0)
    expect(line.getAttribute('contenteditable')).toBeNull()
    // 🚫 Không nằm trong dữ liệu form dưới dạng trường nhập.
    expect(qa<HTMLInputElement>('input').some((i) => i.value === 'playwright-mcp')).toBe(false)
  })
})

/* ─── Helper riêng của nhóm A/G ───────────────────────────────────────────── */

/** Server đã lưu để mở dialog ở chế độ **sửa** (id đóng băng). */
function editableServer(over: Record<string, unknown> = {}) {
  return {
    id: 'pw',
    label: 'Playwright MCP',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: [],
    env: {},
    ...over,
  }
}

/** Chú thích (InfoTooltip) cạnh dòng `Id: …` — nội dung nằm ở `aria-label`. */
function hintText(): string | null {
  const btn = document.body.querySelector('.id-hint .info-tooltip-btn')
  return btn ? btn.getAttribute('aria-label') : null
}

/** Mọi id hậu tố `-n` mà `deriveId` có thể sinh cho `base` ở lần lặp thứ `n`. */
function collectSuffixes(base: string, n: number): string[] {
  const room = 64 - String(n).length - 1
  return [`${base.slice(0, room).replace(/-+$/, '')}-${n}`]
}
