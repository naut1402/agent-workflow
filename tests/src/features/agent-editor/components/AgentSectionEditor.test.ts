import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'
import { emptyDraft } from '@/features/agent-editor/business/agentMarkdown.js'
import AgentSectionEditor from '@/features/agent-editor/components/AgentSectionEditor.vue'
import { localeMessages } from '../../../helpers/localeYaml'

const agentEditorVi = localeMessages('vi', 'agentEditor')

vi.mock('@/features/agent-editor/scripts/AgentSectionEditorApi', () => ({
  saveAgentTemplate: vi.fn(async (draft: any) => ({ name: draft.name })),
}))

import { saveAgentTemplate } from '@/features/agent-editor/scripts/AgentSectionEditorApi'

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

const WorkflowSectionEditorStub = defineComponent({
  name: 'WorkflowSectionEditor',
  props: {
    modelValue: { type: String, default: '' },
  },
  emits: ['update:modelValue', 'message', 'error'],
  setup(props) {
    return () =>
      h('div', {
        class: 'mock-workflow-editor',
        'data-value': props.modelValue,
      })
  },
})

function mountEditor(draftOverrides: Record<string, unknown> = {}) {
  const draft = reactive(
    emptyDraft({
      sections: {
        role: '# Role body',
        skills: '',
        workflow: '### Bước 1: A\n\nbody',
        guardrail: '',
        output: '',
        unclassified: '',
      },
      ...draftOverrides,
    }),
  )
  const w = mount(AgentSectionEditor, {
    props: {
      draft,
      catalog: { skills: [] },
      'onUpdate:draft': (next: typeof draft) => {
        Object.assign(draft, next)
      },
    },
    global: {
      stubs: {
        MarkdownTextEditor: MarkdownTextEditorStub,
        WorkflowSectionEditor: WorkflowSectionEditorStub,
      },
    },
  })
  return { w, draft }
}

describe('AgentSectionEditor', () => {
  it('uses MarkdownTextEditor for non-workflow sections and WorkflowSectionEditor for workflow', () => {
    const { w } = mountEditor()

    const mdEditors = w.findAll('.mock-md-editor')
    expect(mdEditors.length).toBeGreaterThan(0)
    expect(mdEditors[0].attributes('data-height')).toBe('180px')
    expect((mdEditors[0].element as HTMLTextAreaElement).value).toBe('# Role body')

    expect(w.find('.mock-workflow-editor').exists()).toBe(true)
    expect(w.find('.mock-workflow-editor').attributes('data-value')).toContain('Bước 1')

    // Non-workflow sections must not keep a raw cfg-textarea body editor.
    const bodyTextareas = w.findAll('.section-body > textarea.cfg-textarea')
    expect(bodyTextareas.length).toBe(0)
  })

  it('emits update:draft when MarkdownTextEditor changes a section body', async () => {
    const { w, draft } = mountEditor()

    const roleEditor = w.findAll('.mock-md-editor')[0]
    await roleEditor.setValue('## Updated role')
    await flushPromises()

    expect(draft.sections.role).toBe('## Updated role')
    expect(w.emitted('update:draft')?.length).toBeGreaterThan(0)
  })
})

/** Cổng mở bằng tay — giữ request "Lưu template" treo mà không cần fake timer. */
function gate() {
  let release!: () => void
  const p = new Promise<void>((r) => {
    release = r
  })
  return { wait: () => p, release }
}

const SAVE_LABEL = agentEditorVi.section.saveTemplate
const BUSY_LABEL = '…'

function saveButtons(w: ReturnType<typeof mountEditor>['w']) {
  return w
    .findAll('.section-head-actions button')
    .filter((b) => b.text() === SAVE_LABEL || b.text() === BUSY_LABEL)
}

/** Hai section cùng có nội dung → hai nút "Lưu template" độc lập. */
function mountTwoSaveable() {
  vi.spyOn(window, 'prompt').mockReturnValue('tpl-name')
  return mountEditor({
    sections: {
      role: '# Role body',
      skills: '',
      workflow: '### Bước 1: A\n\nbody',
      guardrail: '',
      output: '# Output body',
      unclassified: '',
    },
    section_order: ['role', 'output'],
  })
}

describe('AgentSectionEditor — TC-19 · lưu template theo từng section', () => {
  afterEach(() => {
    vi.mocked(saveAgentTemplate).mockReset()
    vi.mocked(saveAgentTemplate).mockImplementation(async (draft: any) => ({ name: draft.name }))
    vi.restoreAllMocks()
  })

  it('khoá đúng item đang lưu, item còn lại vẫn bấm được nhưng không gửi request thứ hai', async () => {
    const g = gate()
    vi.mocked(saveAgentTemplate).mockImplementation(async (draft: any) => {
      await g.wait()
      return { name: draft.name }
    })
    const { w } = mountTwoSaveable()

    const [a, b] = saveButtons(w)
    expect(b).toBeTruthy()

    await a.trigger('click')
    await flushPromises()

    // `pendingKey === key` → đúng A bị khoá; B vẫn render nhãn bình thường.
    expect(a.attributes('disabled')).toBeDefined()
    expect(a.text()).toBe(BUSY_LABEL)
    expect(b.attributes('disabled')).toBeUndefined()
    expect(b.text()).toBe(SAVE_LABEL)

    // …nhưng guard MỘT SLOT của hook vẫn chặn: B trông bấm được mà bấm không
    // phát sinh request thứ hai. Đây là chủ ý (design E6), không phải lỗi —
    // xem test-spec §8 Q2 về UX của nó.
    await b.trigger('click')
    await flushPromises()
    expect(saveAgentTemplate).toHaveBeenCalledTimes(1)

    g.release()
    await flushPromises()

    // Xong A thì cả hai bấm lại được, và bấm B gửi đúng một request mới.
    expect(saveButtons(w)[0].attributes('disabled')).toBeUndefined()
    await saveButtons(w)[1].trigger('click')
    await flushPromises()
    expect(saveAgentTemplate).toHaveBeenCalledTimes(2)
  })

  it('section rỗng không gọi API và không chiếm slot', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('tpl-name')
    const { w } = mountEditor({
      sections: { role: '', skills: '', workflow: '', guardrail: '', output: '', unclassified: '' },
      section_order: ['role', 'output'],
    })

    await saveButtons(w)[0].trigger('click')
    await flushPromises()

    expect(saveAgentTemplate).not.toHaveBeenCalled()
    expect(w.emitted('error')).toBeTruthy()
    // Slot còn rảnh: lần bấm sau vẫn phải chạy được.
    expect(saveButtons(w)[0].attributes('disabled')).toBeUndefined()
  })
})
