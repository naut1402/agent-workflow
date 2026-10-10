import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { compileWorkflowMarkdown, parseWorkflowMarkdown } from '@/frontend/lib/workflowSteps'
import WorkflowSectionEditor from '@/features/agent-editor/components/WorkflowSectionEditor.vue'
import { localeMessages } from '../../../helpers/localeYaml'

const agentEditorVi = localeMessages('vi', 'agentEditor')

// Luồng "Lưu template" đi qua module API chứ không qua `fetch` trần — mock ở
// tầng module để `stubApi` bên dưới chỉ còn phải lo `/api/pipeline`.
vi.mock('@/features/agent-editor/scripts/WorkflowSectionEditorApi', () => ({
  fetchWorkflowStepTemplates: vi.fn(async () => ({ templates: [] })),
  fetchWorkflowStepTemplate: vi.fn(async () => ({ template: null })),
  saveWorkflowStepTemplate: vi.fn(async (tpl: any) => ({ name: tpl.name })),
  deleteWorkflowStepTemplate: vi.fn(async () => ({ deleted: true })),
}))

import { saveWorkflowStepTemplate } from '@/features/agent-editor/scripts/WorkflowSectionEditorApi'

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

/** Cổng mở bằng tay — giữ request "Lưu template" treo mà không cần fake timer. */
function gate() {
  let release!: () => void
  const p = new Promise<void>((r) => {
    release = r
  })
  return { wait: () => p, release }
}

const SAVE_LABEL = agentEditorVi.workflow.saveTemplate
const BUSY_LABEL = '…'

async function openBuilder(w: ReturnType<typeof mountWorkflow>) {
  await flushPromises()
  await w.findAll('button.workflow-tab').find((b) => b.text() === 'Builder')!.trigger('click')
  await flushPromises()
}

function stepSaveButtons(w: ReturnType<typeof mountWorkflow>) {
  return w
    .findAll('.workflow-builder-step .section-head-actions button')
    .filter((b) => b.text() === SAVE_LABEL || b.text() === BUSY_LABEL)
}

describe('WorkflowSectionEditor — TC-20 · lưu template của step index 0', () => {
  afterEach(() => {
    vi.mocked(saveWorkflowStepTemplate).mockReset()
    vi.mocked(saveWorkflowStepTemplate).mockImplementation(async (tpl: any) => ({ name: tpl.name }))
    vi.restoreAllMocks()
  })

  it('đánh dấu bận đúng step 0, step 1 không bị lây', async () => {
    const g = gate()
    vi.mocked(saveWorkflowStepTemplate).mockImplementation(async (tpl: any) => {
      await g.wait()
      return { name: tpl.name }
    })
    vi.spyOn(window, 'prompt').mockReturnValue('step-tpl')

    const w = mountWorkflow('### Bước 1: A\n\nbody A\n\n### Bước 2: B\n\nbody B')
    await openBuilder(w)

    const [first, second] = stepSaveButtons(w)
    expect(second).toBeTruthy()

    await first.trigger('click')
    await flushPromises()

    // Ca `index === 0` là ca duy nhất phân biệt `pendingKey === String(index)`
    // với mọi biến thể dựa trên truthiness: sentinel cũ là `-1`, và một cài đặt
    // khởi tạo `''` vẫn sai đúng ở hàng đầu mà lint không bắt.
    expect(first.attributes('disabled')).toBeDefined()
    expect(first.text()).toBe(BUSY_LABEL)
    expect(second.attributes('disabled')).toBeUndefined()
    expect(second.text()).toBe(SAVE_LABEL)
    expect(saveWorkflowStepTemplate).toHaveBeenCalledTimes(1)

    g.release()
    await flushPromises()
    expect(stepSaveButtons(w)[0].attributes('disabled')).toBeUndefined()
  })
})
