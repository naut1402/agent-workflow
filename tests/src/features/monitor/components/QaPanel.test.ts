import { mountWithI18n as mount } from '../../../helpers/i18n'
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import QaPanel from '@/features/monitor/components/QaPanel.vue'

/** Lightweight stub — avoid mounting Toast UI Editor in jsdom. */
const MarkdownTextEditorStub = defineComponent({
  name: 'MarkdownTextEditor',
  props: {
    modelValue: { type: String, default: '' },
    height: { type: String, default: '320px' },
    autofocus: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'blur'],
  setup(props, { emit, expose }) {
    expose({ focus: () => {} })
    return () =>
      h('textarea', {
        class: 'mock-md-editor',
        'data-testid': 'markdown-text-editor',
        'data-height': props.height,
        value: props.modelValue,
        onInput: (e: Event) => {
          emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
        },
        onBlur: () => emit('blur'),
      })
  },
})

vi.mock('@/api', () => ({
  saveArtifact: vi.fn(async (_taskId: string, _name: string, content: string) => ({
    content,
    mtime: 2,
  })),
}))

vi.mock('@/shared/markdown', () => ({
  parseMarkdown: (s: string) => `<p>${s}</p>`,
  renderMermaid: vi.fn(async () => {}),
}))

describe('QaPanel — MarkdownTextEditor inline edit', () => {
  it('dblclick mounts MarkdownTextEditor instead of raw textarea', async () => {
    const w = mount(QaPanel, {
      props: {
        qa: '## Question\n\nWhat next?',
        taskId: 'DEMO-1',
        projectId: null,
      },
      global: {
        stubs: { MarkdownTextEditor: MarkdownTextEditorStub },
      },
    })
    await flushPromises()

    await w.find('.md-editable').trigger('dblclick')
    await flushPromises()

    expect(w.find('.mock-md-editor').exists()).toBe(true)
    expect(w.find('textarea.cfg-input.art-editor').exists()).toBe(false)
    expect(w.find('.mock-md-editor').attributes('data-height')).toBe('320px')
  })
})
