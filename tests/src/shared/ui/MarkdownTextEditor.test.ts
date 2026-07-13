import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'

const focus = vi.fn()
const blur = vi.fn()
const destroy = vi.fn()
const setMarkdown = vi.fn()
const setHeight = vi.fn()
const getMarkdown = vi.fn(() => '# hello')

let lastOptions: Record<string, unknown> | null = null

vi.mock('@toast-ui/editor', () => {
  class MockEditor {
    constructor(options: Record<string, unknown>) {
      lastOptions = options
      // Simulate initial load
      queueMicrotask(() => {
        const events = options.events as
          | { change?: () => void; blur?: () => void; focus?: () => void }
          | undefined
        events?.change?.()
      })
    }
    focus = focus
    blur = blur
    destroy = destroy
    setMarkdown = setMarkdown
    setHeight = setHeight
    getMarkdown = getMarkdown
  }
  return { default: MockEditor }
})

vi.mock('@toast-ui/editor/dist/toastui-editor.css', () => ({}))
vi.mock('@toast-ui/editor/dist/theme/toastui-editor-dark.css', () => ({}))

import MarkdownTextEditor from '@/shared/ui/MarkdownTextEditor.vue'

describe('MarkdownTextEditor', () => {
  beforeEach(() => {
    lastOptions = null
    focus.mockClear()
    blur.mockClear()
    destroy.mockClear()
    setMarkdown.mockClear()
    setHeight.mockClear()
    getMarkdown.mockClear()
    getMarkdown.mockReturnValue('# hello')
    document.documentElement.setAttribute('data-theme', 'dark')
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('mounts Toast Editor with markdown modelValue and dark theme', async () => {
    const w = mount(MarkdownTextEditor, {
      props: { modelValue: '# hello', autofocus: true },
    })
    await flushPromises()
    expect(lastOptions).toBeTruthy()
    expect(lastOptions!.initialValue).toBe('# hello')
    expect(lastOptions!.initialEditType).toBe('markdown')
    expect(lastOptions!.theme).toBe('dark')
    expect(lastOptions!.autofocus).toBe(true)
    expect(lastOptions!.usageStatistics).toBe(false)
    expect(w.find('[data-testid="markdown-text-editor"]').exists()).toBe(true)
    w.unmount()
  })

  it('emits update:modelValue on editor change', async () => {
    const w = mount(MarkdownTextEditor, {
      props: { modelValue: '# hello' },
    })
    await flushPromises()
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['# hello'])
    w.unmount()
  })

  it('syncs external modelValue via setMarkdown', async () => {
    const w = mount(MarkdownTextEditor, {
      props: { modelValue: '# hello' },
    })
    await flushPromises()
    getMarkdown.mockReturnValue('# hello')
    await w.setProps({ modelValue: '# updated' })
    await nextTick()
    expect(setMarkdown).toHaveBeenCalledWith('# updated', false)
    w.unmount()
  })

  it('exposes focus() and getMarkdown()', async () => {
    const w = mount(MarkdownTextEditor, {
      props: { modelValue: '# hello' },
    })
    await flushPromises()
    const exposed = w.vm as unknown as { focus: () => void; getMarkdown: () => string }
    exposed.focus()
    expect(focus).toHaveBeenCalled()
    expect(exposed.getMarkdown()).toBe('# hello')
    w.unmount()
  })

  it('destroys editor on unmount', async () => {
    const w = mount(MarkdownTextEditor, {
      props: { modelValue: '' },
    })
    await flushPromises()
    w.unmount()
    expect(destroy).toHaveBeenCalled()
  })

  it('applies disabled class and blurs editor', async () => {
    const w = mount(MarkdownTextEditor, {
      props: { modelValue: 'x', disabled: true },
    })
    await flushPromises()
    expect(w.find('.md-text-editor--disabled').exists()).toBe(true)
    expect(blur).toHaveBeenCalled()
    w.unmount()
  })

  it('can be used via v-model from a parent', async () => {
    const Parent = defineComponent({
      components: { MarkdownTextEditor },
      data: () => ({ text: '## A' }),
      render() {
        return h(MarkdownTextEditor, {
          modelValue: this.text,
          'onUpdate:modelValue': (v: string) => {
            this.text = v
          },
        })
      },
    })
    getMarkdown.mockReturnValue('## A')
    const w = mount(Parent)
    await flushPromises()
    expect((w.vm as { text: string }).text).toBe('## A')
    w.unmount()
  })
})
