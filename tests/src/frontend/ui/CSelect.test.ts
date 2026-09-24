import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, type VNode } from 'vue'
import { mountWithI18n } from '../../helpers/i18n'
import CSelect from '@/frontend/ui/CSelect.vue'

const options = [
  { value: 'both', label: 'Both' },
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'floating', label: 'Floating' },
]

describe('CSelect', () => {
  it('shows the selected label on the trigger', () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: 'sidebar', options, ariaLabel: 'Placement' },
    })
    expect(wrapper.find('.c-select-value').text()).toBe('Sidebar')
    expect(wrapper.find('.c-select-menu').exists()).toBe(false)
  })

  it('opens the custom menu and emits update on option click', async () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: 'both', options, ariaLabel: 'Placement' },
      attachTo: document.body,
    })

    await wrapper.find('.c-select-trigger').trigger('click')
    expect(wrapper.find('.c-select-menu').exists()).toBe(true)
    expect(wrapper.findAll('.c-select-option')).toHaveLength(3)

    await wrapper.findAll('.c-select-option')[2].trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toBe('floating')
    expect(wrapper.find('.c-select-menu').exists()).toBe(false)

    wrapper.unmount()
  })

  it('does not open when disabled', async () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: 'both', options, disabled: true },
    })
    await wrapper.find('.c-select-trigger').trigger('click')
    expect(wrapper.find('.c-select-menu').exists()).toBe(false)
  })

  it('shows the placeholder when modelValue matches no option', () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: '', options, placeholder: 'Pick one' },
    })
    expect(wrapper.find('.c-select-value').text()).toBe('Pick one')
    expect(wrapper.find('.c-select-value').classes()).toContain('is-placeholder')
  })

  it('shows an empty-state row instead of a blank menu when there are no options', async () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: '', options: [] },
    })
    await wrapper.find('.c-select-trigger').trigger('click')
    expect(wrapper.find('.c-select-empty').exists()).toBe(true)
    expect(wrapper.findAll('.c-select-option')).toHaveLength(0)
  })

  it('opens and picks an option with the keyboard alone (no click)', async () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: 'both', options, ariaLabel: 'Placement' },
      attachTo: document.body,
    })

    await wrapper.find('.c-select-trigger').trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('.c-select-menu').exists()).toBe(true)

    await wrapper.find('.c-select-trigger').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('.c-select-trigger').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toBe('floating')
    expect(wrapper.find('.c-select-menu').exists()).toBe(false)

    wrapper.unmount()
  })

  it('closes without picking on Escape', async () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: 'both', options, ariaLabel: 'Placement' },
      attachTo: document.body,
    })

    await wrapper.find('.c-select-trigger').trigger('click')
    await wrapper.find('.c-select-trigger').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.c-select-menu').exists()).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    wrapper.unmount()
  })
})

/**
 * TC-B01…TC-B12 (Tdad47b2b) — «danh sách phải tự đóng sau khi chọn».
 *
 * Hồi quy gốc: `CSelect` đặt trong một `<label>` thì activation behavior của
 * label dội một click tổng hợp lên `.c-select-trigger` và mở lại menu vừa đóng.
 * Nên mọi ca dưới đây dùng `HTMLElement.click()` THẬT — `dispatchEvent` một
 * `MouseEvent` không kích hoạt label-forwarding của jsdom, tức là né đúng cái
 * đang cần chặn.
 *
 * ⚠️ `settleClickGuard()`: `onClickOutside` của `@vueuse` có cờ `isProcessingClick`
 * nhả bằng `setTimeout(0)`. Cú click MỞ menu cũng nổi lên `window` và bật cờ đó,
 * nên click kế tiếp bị nuốt nếu chưa nhả timer. Đây là chi tiết của thư viện,
 * 🚫 không phải hành vi sản phẩm — vì vậy nó nằm trong helper chứ không trong ca.
 */

const settleClickGuard = () => new Promise((r) => setTimeout(r, 0))

/** Component bao: cho phép dựng cây DOM quanh `CSelect` bằng render function. */
function wrap(
  render: (slot: () => VNode) => VNode,
  props: Record<string, unknown>,
  onUpdate?: (v: string) => void,
) {
  return defineComponent({
    setup() {
      const model = ref(String(props.modelValue ?? ''))
      return () =>
        render(() =>
          h(CSelect, {
            ...props,
            modelValue: model.value,
            'onUpdate:modelValue': (v: string) => {
              model.value = v
              onUpdate?.(v)
            },
          } as any),
        )
    },
  })
}

function menuOpen(root: ParentNode = document.body): boolean {
  return Boolean(root.querySelector('.c-select-menu'))
}
function optionByText(text: string, root: ParentNode = document.body): HTMLLIElement {
  const li = [...root.querySelectorAll<HTMLLIElement>('.c-select-option')].find(
    (o) => o.textContent?.trim() === text,
  )
  if (!li) throw new Error(`option not found: ${text}`)
  return li
}
async function openMenu(root: ParentNode = document.body) {
  root.querySelector<HTMLButtonElement>('.c-select-trigger')!.click()
  await flushPromises()
  await settleClickGuard()
}

describe('CSelect — menu đóng sau khi chọn (Tdad47b2b)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  // TC-B03 — ca hồi quy gốc.
  it('TC-B03: bọc trong <label class="cfg-label"> ⇒ click thật vào option đóng menu, phát ĐÚNG một sự kiện', async () => {
    const picked: string[] = []
    const Host = wrap(
      (slot) => h('label', { class: 'cfg-label' }, ['Placement', slot()]),
      { options, ariaLabel: 'Placement', modelValue: 'both' },
      (v) => picked.push(v),
    )
    const wrapper = mountWithI18n(Host, { attachTo: document.body })

    await openMenu()
    expect(menuOpen()).toBe(true)

    optionByText('Floating').click()
    await flushPromises()

    expect(menuOpen()).toBe(false)
    expect(picked).toEqual(['floating'])
    expect(document.querySelector('.c-select-value')!.textContent!.trim()).toBe('Floating')

    wrapper.unmount()
  })

  // TC-B04 — ca đối chứng: không có `<label>` tổ tiên thì hành vi y hệt.
  it('TC-B04: 🚫 không bọc <label> ⇒ hành vi y hệt TC-B03', async () => {
    const picked: string[] = []
    const Host = wrap(
      (slot) => h('div', { class: 'field' }, [h('span', 'Placement'), slot()]),
      { options, ariaLabel: 'Placement', modelValue: 'both' },
      (v) => picked.push(v),
    )
    const wrapper = mountWithI18n(Host, { attachTo: document.body })

    await openMenu()
    optionByText('Floating').click()
    await flushPromises()

    expect(menuOpen()).toBe(false)
    expect(picked).toEqual(['floating'])

    wrapper.unmount()
  })

  /**
   * TC-B05 — ca chặn hồi quy quan trọng nhất của nhóm: `.prevent` trên `<li>`
   * 🚫 KHÔNG được giết đường đóng-khi-click-ngoài.
   *
   * Chạy được trong jsdom nhờ `settleClickGuard()` — xem ghi chú ở đầu khối.
   */
  it('TC-B05: click ra ngoài ⇒ menu đóng, 🚫 không phát sự kiện đổi giá trị', async () => {
    const picked: string[] = []
    const outside = document.createElement('button')
    outside.textContent = 'ngoài'
    document.body.appendChild(outside)

    const Host = wrap(
      (slot) => h('label', { class: 'cfg-label' }, ['Placement', slot()]),
      { options, ariaLabel: 'Placement', modelValue: 'both' },
      (v) => picked.push(v),
    )
    const wrapper = mountWithI18n(Host, { attachTo: document.body })

    await openMenu()
    expect(menuOpen()).toBe(true)

    outside.click()
    await flushPromises()

    expect(menuOpen()).toBe(false)
    expect(picked).toEqual([])

    wrapper.unmount()
  })

  // TC-B06 — `.prevent` chứ 🚫 không `.stop`: luồng sự kiện vẫn lan lên cha.
  it('TC-B06: handler click của cha vẫn nhận được sự kiện, menu vẫn đóng', async () => {
    let parentClicks = 0
    const Host = wrap(
      (slot) => h('div', { class: 'parent', onClick: () => { parentClicks++ } }, [slot()]),
      { options, ariaLabel: 'Placement', modelValue: 'both' },
    )
    const wrapper = mountWithI18n(Host, { attachTo: document.body })

    await openMenu()
    const before = parentClicks
    optionByText('Floating').click()
    await flushPromises()

    expect(parentClicks).toBe(before + 1)
    expect(menuOpen()).toBe(false)

    wrapper.unmount()
  })

  // TC-B07
  it('TC-B07: mở select A rồi bấm trigger select B ⇒ A đóng, B mở, 🚫 không hai menu cùng lúc', async () => {
    const Host = defineComponent({
      setup() {
        const a = ref('both')
        const b = ref('both')
        return () =>
          h('div', {}, [
            h('div', { class: 'slot-a' }, [
              h(CSelect, { options, ariaLabel: 'A', modelValue: a.value, 'onUpdate:modelValue': (v: string) => (a.value = v) }),
            ]),
            h('div', { class: 'slot-b' }, [
              h(CSelect, { options, ariaLabel: 'B', modelValue: b.value, 'onUpdate:modelValue': (v: string) => (b.value = v) }),
            ]),
          ])
      },
    })
    const wrapper = mountWithI18n(Host, { attachTo: document.body })
    const slotA = document.querySelector('.slot-a')!
    const slotB = document.querySelector('.slot-b')!

    await openMenu(slotA)
    expect(menuOpen(slotA)).toBe(true)

    slotB.querySelector<HTMLButtonElement>('.c-select-trigger')!.click()
    await flushPromises()

    expect(menuOpen(slotA)).toBe(false)
    expect(menuOpen(slotB)).toBe(true)
    expect(document.querySelectorAll('.c-select-menu')).toHaveLength(1)

    wrapper.unmount()
  })

  /**
   * TC-B08 — chọn lại chính option đang chọn.
   *
   * ⚠️ Lệch so với `test-spec.md`: spec kỳ vọng 🚫 không phát sự kiện đổi giá trị
   * giả. `pick()` của `CSelect` gọi `emit('update:modelValue')` VÔ ĐIỀU KIỆN —
   * hành vi có sẵn của component dùng chung, 🚫 không do task Tdad47b2b gây ra,
   * và `design.md` §4.2.C chỉ cho phép sửa đúng một dòng (`@click` → `@click.prevent`).
   * Ca này khoá phần thuộc phạm vi task (menu đóng, giá trị không đổi) và ghi
   * nhận hành vi emit hiện tại; phần còn lại là nợ test — xem `test-result.md`.
   */
  it('TC-B08: chọn lại option đang chọn ⇒ menu đóng, giá trị không đổi', async () => {
    const picked: string[] = []
    const Host = wrap(
      (slot) => h('label', { class: 'cfg-label' }, ['Placement', slot()]),
      { options, ariaLabel: 'Placement', modelValue: 'sidebar' },
      (v) => picked.push(v),
    )
    const wrapper = mountWithI18n(Host, { attachTo: document.body })

    await openMenu()
    optionByText('Sidebar').click()
    await flushPromises()

    expect(menuOpen()).toBe(false)
    expect(document.querySelector('.c-select-value')!.textContent!.trim()).toBe('Sidebar')
    // Hiện trạng đã ghi nhận: emit vẫn phát, nhưng mang ĐÚNG giá trị cũ nên
    // không có thay đổi nào tới được model.
    expect(new Set(picked)).toEqual(new Set(['sidebar']))

    wrapper.unmount()
  })
})
