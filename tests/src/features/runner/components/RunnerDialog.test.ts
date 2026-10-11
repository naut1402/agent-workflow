import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, DOMWrapper } from '@vue/test-utils'
import RunnerDialog from '@/features/runner/components/RunnerDialog.vue'
import type { ConnectionOption, ProviderEntry } from '@/features/runner/types'
import { localeMessages } from '../../../helpers/localeYaml'

const runnerVi = localeMessages('vi', 'runner')

vi.mock('@/features/runner/scripts/RunnerDialogApi', () => ({
  saveRunner: vi.fn(async () => ({ ok: true })),
  submitJob: vi.fn(),
  fetchJob: vi.fn(),
}))

// Partial: chỉ `deleteConnection` bị thay — `ConnectionDialog` (con) vẫn import
// phần còn lại của module.
vi.mock('@/features/runner/scripts/ConnectionDialogApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/runner/scripts/ConnectionDialogApi')>()),
  deleteConnection: vi.fn(async () => ({ deleted: true })),
}))

import { saveRunner, submitJob, fetchJob } from '@/features/runner/scripts/RunnerDialogApi'
import { deleteConnection } from '@/features/runner/scripts/ConnectionDialogApi'

const connections: ConnectionOption[] = [
  { id: 'conn-1', label: 'Claude local', providerId: 'claude-code-cli' },
]

const providers: ProviderEntry[] = [{ id: 'claude-code-cli', kind: 'local-console', label: 'Claude Code CLI' }]

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(RunnerDialog, {
    props: { runner: null, connections, providers, ...props },
    attachTo: document.body,
  })
}

// The timeout field migrated from a native `<select>` to `CSelect` (task
// 20260826_001) — drive its actual DOM: click the trigger to open the menu,
// then click the `<li>` whose text matches the preset label.
function timeoutSelectRoot(): HTMLElement {
  const el = [...document.querySelectorAll<HTMLElement>('.c-select')].find(
    (root) => root.querySelector('.c-select-trigger')?.getAttribute('aria-label') === runnerVi.fields.timeoutMs,
  )
  if (!el) throw new Error('timeout CSelect not found')
  return el
}
async function pickTimeoutPreset(label: string) {
  const root = timeoutSelectRoot()
  root.querySelector<HTMLButtonElement>('.c-select-trigger')!.click()
  await flushPromises()
  const option = [...document.querySelectorAll<HTMLLIElement>('.c-select-option')].find(
    (li) => li.textContent?.trim() === label,
  )
  if (!option) throw new Error(`preset not found: ${label}`)
  option.click()
  await flushPromises()
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('RunnerDialog — timeout dropdown', () => {
  it('renders timeout dropdown with 5 presets, default 10 phút', async () => {
    mountDialog()
    const root = timeoutSelectRoot()
    expect(root.querySelector('.c-select-value')?.textContent?.trim()).toBe(runnerVi.timeoutOptions.min10)

    root.querySelector<HTMLButtonElement>('.c-select-trigger')!.click()
    await flushPromises()
    const options = [...document.querySelectorAll('.c-select-option')]
    expect(options).toHaveLength(5)
  })

  it('selecting 60 phút persists timeoutMs = 3_600_000 on save payload', async () => {
    mountDialog()
    await pickTimeoutPreset(runnerVi.timeoutOptions.hour1)

    const nameInput = new DOMWrapper(document.querySelector('.field input.cfg-input')!)
    await nameInput.setValue('Runner test')

    const saveBtn = [...document.querySelectorAll('button.btn-primary')].find((b) =>
      b.textContent?.includes('Lưu'),
    ) as HTMLButtonElement
    saveBtn.click()
    await flushPromises()

    expect(saveRunner).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ timeoutMs: 3_600_000 }) }),
    )
  })
})

// Lưới an toàn cấu trúc cho 2 regression UI của 1.1.0 (task Tb692264f). jsdom
// không tính layout nên không assert được hình học — 2 case dưới chỉ chốt phần
// cấu trúc gây ra lỗi; phần hình học do e2e (`test-e2e/runner.spec.ts`) gánh.
describe('RunnerDialog — cấu trúc chống regression UI', () => {
  it('không truyền class control native vào CSelect', () => {
    mountDialog()
    const roots = [...document.querySelectorAll('.c-select')]
    // Không có assert này thì test xanh giả khi markup/selector đổi.
    expect(roots.length).toBeGreaterThan(0)
    for (const root of roots) {
      expect(root.classList.contains('cfg-input')).toBe(false)
      expect(root.classList.contains('cfg-textarea')).toBe(false)
    }
  })

  // Đúng một vùng cuộn: 2 .modal-body lồng nhau sinh scrollbar kép, 0 thì hàng
  // nút bị vẽ ra ngoài border dưới khi nội dung vượt max-height của .modal.
  // Hàng nút đi qua slot `footer` của CDialog: ngoài vùng cuộn, ngoài overlay.
  it('dialog có đúng một .modal-body; .modal-head và .modal-actions nằm ngoài nó', () => {
    mountDialog()
    const modal = document.querySelector('.modal')!
    const bodies = modal.querySelectorAll('.modal-body')
    expect(bodies).toHaveLength(1)
    expect(bodies[0].querySelector('.modal-head')).toBeNull()
    const actions = modal.querySelector('.modal-actions')!
    expect(actions.querySelectorAll('button').length).toBeGreaterThan(0)
    expect(actions.closest('.modal-body')).toBeNull()
    expect(actions.closest('.c-loading-host')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T6fabee9b — dialog phải nói trước id sẽ tạo, và chỉ đường "tạo mới" mới gửi cờ
// `create`. Sửa một runner đã có thì 🚫 không bao giờ được 409: payload sửa mà
// mang cờ đó là tự khoá chính mình ra khỏi bản ghi của mình.
// ─────────────────────────────────────────────────────────────────────────────

const EXISTING_RUNNER = {
  id: 'claude-1',
  name: 'Claude 1',
  connectionId: 'conn-1',
  enabled: true,
  maxConcurrency: 1,
  config: { timeoutMs: 600000 },
}

function hint(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('.runner-dialog .cfg-hint')
}
function nameInput(): DOMWrapper<Element> {
  return new DOMWrapper(document.querySelector('.field input.cfg-input')!)
}
async function clickSave() {
  const btn = [...document.querySelectorAll('button.btn-primary')].find((b) =>
    b.textContent?.includes('Lưu'),
  ) as HTMLButtonElement
  btn.click()
  await flushPromises()
}

describe('RunnerDialog — cờ create và hint id', () => {
  it('TC-D38: mode create ⇒ hiện id suy từ tên, payload mang create: true', async () => {
    mountDialog({ mode: 'create' })
    await nameInput().setValue('Claude 1')

    expect(hint()?.textContent?.trim()).toBe(runnerVi.hints.generatedId.replace('{id}', 'claude-1'))

    await clickSave()
    expect(saveRunner).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude-1', create: true }))
  })

  it('TC-D38b: mode edit ⇒ 🚫 không hint, payload 🚫 không có cờ create', async () => {
    mountDialog({ runner: EXISTING_RUNNER, mode: 'edit' })

    expect(hint()).toBe(null)

    await clickSave()
    const payload = vi.mocked(saveRunner).mock.calls[0][0] as Record<string, unknown>
    expect(payload.id).toBe('claude-1')
    expect('create' in payload).toBe(false)
  })

  it('TC-D38c: mode copy ⇒ giữ id đã mint (🚫 không suy lại từ tên) và vẫn gửi create', async () => {
    mountDialog({ runner: { ...EXISTING_RUNNER, id: 'claude-1-copy', name: 'Claude 1 (copy)' }, mode: 'copy' })

    expect(hint()?.textContent?.trim()).toBe(
      runnerVi.hints.generatedId.replace('{id}', 'claude-1-copy'),
    )

    await clickSave()
    expect(saveRunner).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'claude-1-copy', create: true }),
    )
  })

  it('TC-D39: lỗi 409 ⇒ hiện message i18n, 🚫 không hiện chuỗi thô của BE', async () => {
    // Nhận diện bằng status. Message BE là chuỗi cho log/dev — i18n-hoá nó
    // 🚫 không được làm chết nhánh này.
    vi.mocked(saveRunner).mockRejectedValueOnce(
      Object.assign(new Error('runner id "claude-1" đã tồn tại'), { status: 409 }),
    )
    mountDialog({ mode: 'create' })
    await nameInput().setValue('Claude 1')

    await clickSave()

    const banner = document.body.querySelector('.err-banner')
    expect(banner?.textContent?.trim()).toBe(runnerVi.errors.idTaken.replace('{id}', 'claude-1'))
    expect(banner?.textContent).not.toContain('runner id')
  })

  it('TC-D39b: lỗi không phải 409 ⇒ vẫn hiện message gốc', async () => {
    vi.mocked(saveRunner).mockRejectedValueOnce(
      Object.assign(new Error('connectionId is required'), { status: 400 }),
    )
    mountDialog({ mode: 'create' })
    await nameInput().setValue('Claude 1')

    await clickSave()

    expect(document.body.querySelector('.err-banner')?.textContent?.trim()).toBe(
      'connectionId is required',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tef1d7fb7 — chạy thử và xoá connection đi qua `useApiAction`. Chạy thử tách
// hai pha: `submitJob` có guard + overlay, vòng poll sau đó KHÔNG phủ overlay
// (khoá form 120 s chỉ để chờ job nền) nhưng nút chạy thử vẫn tắt tới khi xong.
// ─────────────────────────────────────────────────────────────────────────────

function buttonByText(text: string): HTMLButtonElement {
  const btn = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )
  if (!btn) throw new Error(`button not found: ${text}`)
  return btn
}
const overlay = () => document.body.querySelector('.c-loading-overlay')

describe('RunnerDialog — chạy thử: guard submit, poll không phủ overlay', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function holdSubmit(): (job: Record<string, unknown>) => void {
    let release: (v: unknown) => void = () => {}
    vi.mocked(submitJob).mockImplementationOnce(() => new Promise((r) => { release = r }) as any)
    return (job) => release({ job })
  }

  it('bấm hai lần khi đang submit ⇒ một submitJob, overlay hiện; vào poll thì gỡ overlay, nút vẫn tắt', async () => {
    // Chỉ giả `setTimeout`: `flushPromises` chạy trên `setImmediate` thật.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const release = holdSubmit()
    vi.mocked(fetchJob).mockResolvedValue({ job: { id: 'j1', status: 'succeeded' } } as any)
    mountDialog({ runner: EXISTING_RUNNER, mode: 'edit' })

    const btn = buttonByText(runnerVi.actions.test)
    btn.click()
    btn.click()
    await flushPromises()

    expect(submitJob).toHaveBeenCalledTimes(1)
    expect(overlay()).not.toBe(null)

    release({ id: 'j1', status: 'queued' })
    await flushPromises()

    // Pha poll: overlay đã gỡ, nút chạy thử vẫn tắt, form dùng được.
    expect(overlay()).toBe(null)
    expect(buttonByText(runnerVi.actions.testing).disabled).toBe(true)
    expect(buttonByText(runnerVi.actions.save).disabled).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(fetchJob).toHaveBeenCalledTimes(1)
    expect(buttonByText(runnerVi.actions.test).disabled).toBe(false)
    expect(document.body.querySelector('.ok-banner')?.textContent).toContain('Smoke test')
  })

  it('submit lỗi ⇒ hiện lỗi, không poll, nút không kẹt', async () => {
    vi.mocked(submitJob).mockRejectedValueOnce(new Error('runner busy'))
    mountDialog({ runner: EXISTING_RUNNER, mode: 'edit' })

    buttonByText(runnerVi.actions.test).click()
    await flushPromises()

    expect(document.body.querySelector('.err-banner')?.textContent?.trim()).toBe('runner busy')
    expect(fetchJob).not.toHaveBeenCalled()
    expect(buttonByText(runnerVi.actions.test).disabled).toBe(false)
  })

  it('đóng dialog giữa vòng poll ⇒ dừng poll, không gọi fetchJob nữa', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(submitJob).mockResolvedValueOnce({ job: { id: 'j1', status: 'queued' } } as any)
    vi.mocked(fetchJob).mockResolvedValue({ job: { id: 'j1', status: 'running' } } as any)
    const w = mountDialog({ runner: EXISTING_RUNNER, mode: 'edit' })

    buttonByText(runnerVi.actions.test).click()
    await flushPromises()
    w.unmount()

    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()

    expect(fetchJob).not.toHaveBeenCalled()
  })
})

describe('RunnerDialog — xoá connection qua useApiAction', () => {
  function trashButton(): HTMLButtonElement {
    const btn = document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${runnerVi.connectionDialog.deleteConnection}"]`,
    )
    if (!btn) throw new Error('trash button not found')
    return btn
  }

  it('bấm hai lần khi đang chờ ⇒ một confirm, một API; overlay hiện tới khi xong', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let release: (v: unknown) => void = () => {}
    vi.mocked(deleteConnection).mockImplementationOnce(() => new Promise((r) => { release = r }) as any)
    const w = mountDialog({ runner: EXISTING_RUNNER, mode: 'edit' })

    trashButton().click()
    trashButton().click()
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(deleteConnection).toHaveBeenCalledTimes(1)
    expect(overlay()).not.toBe(null)
    // Footer nằm ngoài overlay ⇒ tự khoá bằng `:disabled`.
    expect(buttonByText(runnerVi.actions.save).disabled).toBe(true)

    release({ deleted: true })
    await flushPromises()

    // Overlay đã kịp vẽ thì giữ tối thiểu `minVisibleMs` — chờ, đừng assert tức thì.
    await vi.waitFor(() => expect(overlay()).toBe(null))
    expect(w.emitted('refreshed')).toHaveLength(1)
    confirmSpy.mockRestore()
  })
})
