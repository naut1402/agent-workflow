import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import { mountWithI18n } from '../../helpers/i18n'
import CDialog from '@/frontend/ui/CDialog.vue'

/**
 * Bề mặt test là DOM teleport ra `document.body` + sự kiện `close` — hợp đồng
 * mà mọi dialog gọi `CDialog` tiêu thụ. Teleport chạy thật (không stub) vì vị
 * trí render là một phần của hợp đồng.
 *
 * ⚠️ Stack `Escape` là state cấp module: mọi wrapper phải được unmount ở
 * `afterEach`, sót một cái là dialog "trên cùng" của ca sau bị lệch.
 */

const mounted: VueWrapper[] = []

function mountDialog(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  const w = mountWithI18n(CDialog, {
    props: { title: 'Tiêu đề', ...props },
    slots: { default: '<p class="body-content">nội dung</p>', ...slots },
    attachTo: document.body,
  })
  mounted.push(w)
  return w
}

const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)
const qa = (sel: string) => [...document.body.querySelectorAll(sel)]

function pressEscape(target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  document.body.innerHTML = ''
})

describe('CDialog — khung & a11y', () => {
  it('teleport ra body: .modal-backdrop › .modal[role=dialog][aria-modal=true]', () => {
    mountDialog()
    const modal = q('.modal-backdrop > .modal')
    expect(modal).not.toBeNull()
    expect(modal!.getAttribute('role')).toBe('dialog')
    expect(modal!.getAttribute('aria-modal')).toBe('true')
  })

  it('aria-labelledby trỏ vào heading chứa đúng tiêu đề', () => {
    mountDialog({ title: 'Thêm runner' })
    const labelId = q('.modal')!.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    const heading = document.getElementById(labelId!)
    expect(heading?.tagName).toBe('H3')
    expect(heading?.textContent?.trim()).toBe('Thêm runner')
  })

  /** `useId()` duy nhất trong phạm vi một app — đúng như production (một app). */
  it('hai dialog cùng app có id tiêu đề khác nhau', () => {
    const Pair = defineComponent({ render: () => [h(CDialog, { title: 'A' }), h(CDialog, { title: 'B' })] })
    mounted.push(mountWithI18n(Pair, { attachTo: document.body }))
    const ids = qa('.modal').map((m) => m.getAttribute('aria-labelledby'))
    expect(new Set(ids).size).toBe(2)
  })

  it('class của caller rơi xuống .modal, không rơi xuống backdrop', () => {
    mounted.push(
      mountWithI18n(CDialog, { props: { title: 't' }, attrs: { class: 'runner-dialog' }, attachTo: document.body }),
    )
    expect(q('.modal.runner-dialog')).not.toBeNull()
    expect(q('.modal-backdrop.runner-dialog')).toBeNull()
  })
})

describe('CDialog — slot', () => {
  it('slot mặc định nằm trong .modal-body; footer và subhead nằm ngoài vùng cuộn', () => {
    mountDialog({}, {
      subhead: '<div class="sub">sub</div>',
      footer: '<div class="foot">foot</div>',
    })
    expect(q('.modal-body .body-content')).not.toBeNull()
    expect(q('.sub')!.closest('.modal-body')).toBeNull()
    expect(q('.foot')!.closest('.modal-body')).toBeNull()
    expect(q('.foot')!.closest('.c-loading-host')).toBeNull()
  })

  it('slot title thay tiêu đề prop, vẫn nằm trong heading được aria-labelledby trỏ tới', () => {
    mountDialog({ title: '' }, { title: 'Duyệt <code>design.md</code>' })
    const heading = document.getElementById(q('.modal')!.getAttribute('aria-labelledby')!)
    expect(heading?.querySelector('code')?.textContent).toBe('design.md')
  })

  it('slot head đứng trong header, sau tiêu đề và trước nút đóng', () => {
    mountDialog({}, { head: '<span class="counter">1/4</span>' })
    const children = [...q('.modal-head')!.children].map((el) => el.className)
    expect(children).toEqual(['c-dialog-title', 'counter', 'modal-close'])
  })
})

describe('CDialog — đóng dialog', () => {
  it('nút ✕ emit close; nhãn mặc định lấy common.dialog.close', () => {
    const w = mountDialog()
    const btn = q<HTMLButtonElement>('.modal-close')!
    expect(btn.getAttribute('aria-label')).toBe('Đóng')
    btn.click()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('closeLabel ghi đè nhãn nút ✕', () => {
    mountDialog({ closeLabel: 'Thoát' })
    expect(q('.modal-close')!.getAttribute('aria-label')).toBe('Thoát')
    expect(q('.modal-close')!.getAttribute('title')).toBe('Thoát')
  })

  it('click backdrop emit close; click bên trong .modal thì không', () => {
    const w = mountDialog()
    q('.body-content')!.click()
    expect(w.emitted('close')).toBeUndefined()
    q('.modal-backdrop')!.click()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Escape emit close; phím khác thì không', () => {
    const w = mountDialog()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(w.emitted('close')).toBeUndefined()
    pressEscape()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Escape đã bị control con preventDefault (vd CSelect đóng menu) thì không đóng dialog', () => {
    const w = mountDialog({}, { default: '<input class="inner" />' })
    const input = q('.inner')!
    input.addEventListener('keydown', (e) => e.preventDefault())
    pressEscape(input)
    expect(w.emitted('close')).toBeUndefined()
  })

  it('closeOnEscape=false chặn Escape nhưng ✕ và backdrop vẫn đóng được', () => {
    const w = mountDialog({ closeOnEscape: false })
    pressEscape()
    expect(w.emitted('close')).toBeUndefined()
    q<HTMLButtonElement>('.modal-close')!.click()
    q('.modal-backdrop')!.click()
    expect(w.emitted('close')).toHaveLength(2)
  })

  it('closeDisabled chặn cả ba đường đóng và khoá nút ✕', () => {
    const w = mountDialog({ closeDisabled: true })
    const btn = q<HTMLButtonElement>('.modal-close')!
    expect(btn.disabled).toBe(true)
    btn.click()
    q('.modal-backdrop')!.click()
    pressEscape()
    expect(w.emitted('close')).toBeUndefined()
  })
})

describe('CDialog — dialog lồng nhau', () => {
  it('Escape chỉ đóng dialog mount sau cùng', () => {
    const outer = mountDialog({ title: 'ngoài' })
    const inner = mountDialog({ title: 'trong' })
    pressEscape()
    expect(inner.emitted('close')).toHaveLength(1)
    expect(outer.emitted('close')).toBeUndefined()
  })

  it('dialog trên cùng unmount thì Escape về lại dialog bên dưới', () => {
    const outer = mountDialog({ title: 'ngoài' })
    const inner = mountDialog({ title: 'trong' })
    mounted.splice(mounted.indexOf(inner), 1)
    inner.unmount()
    pressEscape()
    expect(outer.emitted('close')).toHaveLength(1)
  })

  it('dialog trên cùng đặt closeOnEscape=false thì Escape không rơi xuống dialog dưới', () => {
    const outer = mountDialog({ title: 'ngoài' })
    const inner = mountDialog({ title: 'trong', closeOnEscape: false })
    pressEscape()
    expect(inner.emitted('close')).toBeUndefined()
    expect(outer.emitted('close')).toBeUndefined()
  })
})

describe('CDialog — loading & kích thước', () => {
  it('.c-loading-host bọc .modal-body; loading bật thì overlay có mặt ngay', async () => {
    const w = mountDialog()
    const host = q('.c-loading-host')!
    expect(host.querySelector(':scope > .modal-body')).not.toBeNull()
    expect(q('.c-loading-overlay')).toBeNull()

    await w.setProps({ loading: true })
    expect(host.querySelector(':scope > .c-loading-overlay')).not.toBeNull()
  })

  /** jsdom bỏ giá trị `min()` / `calc()` nên ca này dùng giá trị px thuần. */
  it('prop kích thước thành style inline của .modal', () => {
    mountDialog({ width: '520px', height: '700px', minHeight: '560px', maxHeight: '92vh' })
    const style = q<HTMLElement>('.modal')!.style
    expect(style.width).toBe('520px')
    expect(style.height).toBe('700px')
    expect(style.minHeight).toBe('560px')
    expect(style.maxHeight).toBe('92vh')
  })

  it('không truyền kích thước thì không đặt style inline', () => {
    mountDialog()
    expect(q('.modal')!.getAttribute('style') ?? '').toBe('')
  })

  it('resizable gắn modifier c-dialog--resizable', () => {
    mountDialog({ resizable: true })
    expect(q('.modal')!.classList.contains('c-dialog--resizable')).toBe(true)
  })
})
