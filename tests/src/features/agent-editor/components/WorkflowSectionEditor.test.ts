import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { compileWorkflowMarkdown, parseWorkflowMarkdown } from '@/core/lib/workflowSteps'
import WorkflowSectionEditor from '@/features/agent-editor/components/WorkflowSectionEditor.vue'

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

function stubApi() {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/pipeline')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ pipeline: { steps: [{ id: 'investigator', name: 'Investigate', description: 'desc' }] } }),
      }
    }
    if (url.includes('/api/workflow-step-templates')) {
      return { ok: true, status: 200, json: async () => ({ templates: [] }) }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

function mountWorkflow(modelValue = '') {
  stubApi()
  return mount(WorkflowSectionEditor, {
    props: { modelValue },
    global: {
      stubs: {
        MarkdownTextEditor: MarkdownTextEditorStub,
      },
    },
  })
}

describe('WorkflowSectionEditor', () => {
  it('Direct mode mounts MarkdownTextEditor and emits update:modelValue', async () => {
    const w = mountWorkflow('### Bước 1: A\n\nbody A')
    await flushPromises()

    const editor = w.find('.mock-md-editor')
    expect(editor.exists()).toBe(true)
    expect(editor.attributes('data-height')).toBe('240px')
    expect((editor.element as HTMLTextAreaElement).value).toContain('Bước 1')

    await editor.setValue('### Bước 1: Updated\n\nnew body')
    await flushPromises()

    expect(w.emitted('update:modelValue')?.[0]?.[0]).toBe('### Bước 1: Updated\n\nnew body')
    expect(w.find('textarea.cfg-textarea').exists()).toBe(false)
  })

  it('Builder step body uses MarkdownTextEditor and compile path stays intact', async () => {
    const initial = '### Bước 1: Khảo sát\n\nNội dung A\n\n<!-- pipeline_step:investigator -->'
    const w = mountWorkflow(initial)
    await flushPromises()

    const builderTab = w.findAll('button.workflow-tab').find((b) => b.text() === 'Builder')
    expect(builderTab).toBeTruthy()
    await builderTab!.trigger('click')
    await flushPromises()

    const bodyEditor = w.find('.mock-md-editor')
    expect(bodyEditor.exists()).toBe(true)
    expect(bodyEditor.attributes('data-height')).toBe('160px')
    expect((bodyEditor.element as HTMLTextAreaElement).value).toBe('Nội dung A')

    await bodyEditor.setValue('Nội dung A **updated**')
    await flushPromises()

    const emitted = w.emitted('update:modelValue')
    expect(emitted?.length).toBeGreaterThan(0)
    const last = emitted![emitted!.length - 1][0] as string
    expect(last).toContain('Nội dung A **updated**')
    expect(last).toContain('<!-- pipeline_step:investigator -->')

    // Characterization: parse → edit body → compile still round-trips structure.
    const parsed = parseWorkflowMarkdown(last)
    expect(parsed).toEqual([
      {
        title: 'Khảo sát',
        body: 'Nội dung A **updated**',
        pipelineStepId: 'investigator',
      },
    ])
    expect(compileWorkflowMarkdown(parsed)).toBe(last)
  })

  it('switching Builder → Direct compiles steps back to markdown', async () => {
    const initial = '### Bước 1: A\n\nbody A'
    const w = mountWorkflow(initial)
    await flushPromises()

    await w.findAll('button.workflow-tab').find((b) => b.text() === 'Builder')!.trigger('click')
    await flushPromises()
    await w.findAll('button.workflow-tab').find((b) => b.text() === 'Nhập trực tiếp')!.trigger('click')
    await flushPromises()

    const emitted = w.emitted('update:modelValue')
    expect(emitted?.length).toBeGreaterThan(0)
    const last = emitted![emitted!.length - 1][0] as string
    expect(parseWorkflowMarkdown(last)).toEqual(parseWorkflowMarkdown(initial))
  })
})
