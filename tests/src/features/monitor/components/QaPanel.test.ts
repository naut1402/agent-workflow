import { mountWithI18n as mount } from '../../../helpers/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const { saveArtifact, sendTaskFeedback } = vi.hoisted(() => ({
  saveArtifact: vi.fn(async (_taskId: string, _name: string, content: string) => ({
    content,
    mtime: 2,
  })),
  sendTaskFeedback: vi.fn(
    async (_taskId: string, _feedback: string, _opts?: { stepId?: string }) => ({
      job: { id: 'job-1' },
    }),
  ),
}))

vi.mock('@/api', () => ({ saveArtifact, sendTaskFeedback }))

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

describe('QaPanel — quiz layout for questions with suggested answers', () => {
  const QUIZ_QA = [
    '## Q1 — Hook nào?',
    '',
    'Mô tả.',
    '',
    '**Lựa chọn:**',
    '- A. Dùng onMounted',
    '- B. Dùng mixin',
    '',
    '**Trả lời:**',
    '',
  ].join('\n')

  beforeEach(() => {
    saveArtifact.mockClear()
    sendTaskFeedback.mockClear()
  })

  it('renders one radio per suggested answer plus an "Other" option', () => {
    const w = mount(QaPanel, {
      props: { qa: QUIZ_QA, taskId: 'DEMO-1', projectId: null, stepId: 'investigate' },
    })

    const radios = w.findAll('input[type="radio"]')
    expect(radios).toHaveLength(3) // A, B, Other
    expect(w.text()).toContain('Dùng onMounted')
    expect(w.text()).toContain('Dùng mixin')
  })

  it('shows a free-text input only after picking "Other"', async () => {
    const w = mount(QaPanel, {
      props: { qa: QUIZ_QA, taskId: 'DEMO-1', projectId: null, stepId: 'investigate' },
    })

    expect(w.find('textarea.qa-other-input').exists()).toBe(false)
    const radios = w.findAll('input[type="radio"]')
    await radios[2].setValue() // last radio is "Other"
    expect(w.find('textarea.qa-other-input').exists()).toBe(true)
  })

  it('Submit writes the chosen answer and resumes the session via sendTaskFeedback', async () => {
    const w = mount(QaPanel, {
      props: { qa: QUIZ_QA, taskId: 'DEMO-1', projectId: null, stepId: 'investigate' },
    })

    const submitBtn = w.find('button.btn-primary')
    expect((submitBtn.element as HTMLButtonElement).disabled).toBe(true)

    const radios = w.findAll('input[type="radio"]')
    await radios[0].setValue() // pick choice A
    expect((submitBtn.element as HTMLButtonElement).disabled).toBe(false)

    await submitBtn.trigger('click')
    await flushPromises()

    expect(saveArtifact).toHaveBeenCalledTimes(1)
    const [, , writtenContent] = saveArtifact.mock.calls[0]
    expect(writtenContent).toContain('**Trả lời:** Dùng onMounted')

    expect(sendTaskFeedback).toHaveBeenCalledTimes(1)
    const [taskId, , opts] = sendTaskFeedback.mock.calls[0]
    expect(taskId).toBe('DEMO-1')
    expect(opts).toEqual({ stepId: 'investigate' })
  })
})
