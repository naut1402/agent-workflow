import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CollapsibleSection from '@/features/pipeline-editor/components/CollapsibleSection.vue'

function mountSection(props: Record<string, any> = {}) {
  return mount(CollapsibleSection, {
    props: { title: 'Agents', ...props },
    slots: { default: '<div class="body">nội dung</div>' },
  })
}

describe('CollapsibleSection', () => {
  it('prop open điều khiển <details open>', async () => {
    const w = mountSection({ open: false })
    const details = w.find('details').element as HTMLDetailsElement
    expect(details.open).toBe(false)

    await w.setProps({ open: true })
    expect((w.find('details').element as HTMLDetailsElement).open).toBe(true)
  })

  it('render title và count', () => {
    const w = mountSection({ count: 3 })
    expect(w.find('.editor-section-title').text()).toBe('Agents')
    expect(w.find('.editor-section-count').text()).toBe('3')
  })

  it('không render count khi không truyền', () => {
    const w = mountSection()
    expect(w.find('.editor-section-count').exists()).toBe(false)
  })

  it('count = 0 vẫn hiện (khác với không truyền)', () => {
    const w = mountSection({ count: 0 })
    expect(w.find('.editor-section-count').text()).toBe('0')
  })

  it('click header emit toggle', async () => {
    const w = mountSection({ open: true })
    await w.find('summary').trigger('click')
    expect(w.emitted('toggle')).toHaveLength(1)
  })

  // Trạng thái mở do cha giữ; để `<details>` tự đảo là hai nguồn sự thật.
  it('click header không tự đảo trạng thái mở', async () => {
    const w = mountSection({ open: true })
    await w.find('summary').trigger('click')
    expect((w.find('details').element as HTMLDetailsElement).open).toBe(true)
  })

  it('render slot mặc định vào phần thân', () => {
    const w = mountSection({ open: true })
    expect(w.find('.editor-section-body .body').text()).toBe('nội dung')
  })
})
