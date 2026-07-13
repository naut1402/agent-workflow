import { mountWithI18n as mount } from '../../../helpers/i18n'
import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'
import { emptyDraft } from '@shared/agentMarkdown.js'
import AgentSectionEditor from '@/features/agent-editor/components/AgentSectionEditor.vue'

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
