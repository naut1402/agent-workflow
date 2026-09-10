import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { mountWithI18n as mount } from '../../../helpers/i18n'
import KnowledgePanel from '@/features/knowledge/components/KnowledgePanel.vue'

/** Lightweight stub — avoid mounting Toast UI Editor in jsdom. */
const MarkdownTextEditorStub = defineComponent({
  name: 'MarkdownTextEditor',
  props: {
    modelValue: { type: String, default: '' },
    height: { type: String, default: '320px' },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('textarea', {
        class: 'mock-md-editor',
        'data-height': props.height,
        value: props.modelValue,
        onInput: (e: Event) => {
          emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
        },
      })
  },
})

afterEach(() => vi.unstubAllGlobals())

function mountPanel() {
  return mount(KnowledgePanel, {
    global: {
      stubs: {
        MarkdownTextEditor: MarkdownTextEditorStub,
      },
    },
  })
}

describe('KnowledgePanel', () => {
  it('mounts and loads the list (fetch stubbed)', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes('/collections')
          ? { collections: [] }
          : { entries: [], tags: [{ tag: 'php', count: 1 }] },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const w = mountPanel()
    await flushPromises()

    expect(w.find('.knowledge-panel').exists()).toBe(true)
    // onMounted → MỘT request mang cả entry lẫn facet tag (`include=tags`);
    // `/api/knowledge/tags` walk lại toàn store nên không được gọi thêm nữa.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('include=tags'))).toBe(true)
    expect(urls.some((u) => u.startsWith('/api/knowledge/tags'))).toBe(false)
  })

  it('mounts MarkdownTextEditor and binds draft.content via v-model', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes('/collections') ? { collections: [] } : { entries: [], tags: [] },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const w = mountPanel()
    await flushPromises()

    const editor = w.find('.mock-md-editor')
    expect(editor.exists()).toBe(true)
    expect(editor.attributes('data-height')).toBe('400px')
    expect(editor.element).toBeInstanceOf(HTMLTextAreaElement)
    expect((editor.element as HTMLTextAreaElement).value).toBe('')

    await editor.setValue('# Hello knowledge')
    await flushPromises()

    // draft.content is updated through v-model on the stub
    const vm = w.vm as unknown as { draft: { content: string } }
    expect(vm.draft.content).toBe('# Hello knowledge')
  })
})
