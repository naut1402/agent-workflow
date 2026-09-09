import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, DOMWrapper } from '@vue/test-utils'
import RunnerDialog from '@/features/runner/components/RunnerDialog.vue'
import type { ConnectionOption, ProviderEntry } from '@/features/runner/types'
import runnerVi from '@/features/runner/locales/vi'

vi.mock('@/features/runner/scripts/RunnerDialogApi', () => ({
  saveRunner: vi.fn(async () => ({ ok: true })),
  submitJob: vi.fn(),
  fetchJob: vi.fn(),
}))

import { saveRunner } from '@/features/runner/scripts/RunnerDialogApi'

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
  // Dialog này cố ý đặt .modal-actions *trong* .modal-body (margin-top: auto),
  // nên chỉ assert .modal-head nằm ngoài.
  it('dialog có đúng một .modal-body và .modal-head nằm ngoài nó', () => {
    mountDialog()
    const modal = document.querySelector('.modal')!
    const bodies = modal.querySelectorAll('.modal-body')
    expect(bodies).toHaveLength(1)
    expect(bodies[0].querySelector('.modal-head')).toBeNull()
    expect(modal.querySelectorAll('.modal-actions button').length).toBeGreaterThan(0)
  })
})
