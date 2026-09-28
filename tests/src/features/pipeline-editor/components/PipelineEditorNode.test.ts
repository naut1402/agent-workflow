import { computed } from 'vue'
import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import PipelineEditorNode from '@/features/pipeline-editor/components/PipelineEditorNode.vue'

// Tbfb52394 · TC-G13 của test-spec — badge model trên node canvas.
//
// Chỉ nhìn canvas phải biết được step nào KHÔNG chạy model mặc định; nếu không,
// một pin đặt nhầm chỉ lộ ra lúc job đã chạy. Nhãn đến từ `provide` của
// PipelineEditor (Vue Flow chỉ truyền `data` xuống node, không truyền prop
// tuỳ ý), nên map rỗng là trạng thái hợp lệ phải xử lý được.

// `<Handle>` chỉ chạy trong context VueFlow thật — node test độc lập nên stub.
function mountNode(
  data: Record<string, unknown>,
  labels: Record<string, string> | null = { 'r-gemini': 'gemini-2.5-pro' },
) {
  return mountWithI18n(PipelineEditorNode, {
    props: { data },
    global: {
      stubs: { Handle: true },
      provide: labels
        ? { pipelineRunnerModelLabels: computed(() => new Map(Object.entries(labels))) }
        : {},
    },
  })
}

const STEP = { label: 'Review', agent: 'dev-agent-teams:reviewer' }

describe('PipelineEditorNode — badge model', () => {
  it('TC-G13: step đã pin ⇒ node hiện badge mang NHÃN MODEL, không phải runner id', () => {
    const w = mountNode({ ...STEP, runner_id: 'r-gemini' })
    const badge = w.find('.node-editor-model')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('gemini-2.5-pro')
    expect(badge.text()).not.toContain('r-gemini')
    // Tên model dài hơn bề ngang node nên bị cắt — giá trị đầy đủ phải còn ở title.
    expect(badge.attributes('title')).toBe('gemini-2.5-pro')
  })

  it('TC-G13b: step không pin ⇒ KHÔNG có badge (mặc định không phải thông tin)', () => {
    expect(mountNode(STEP).find('.node-editor-model').exists()).toBe(false)
    expect(mountNode({ ...STEP, runner_id: '' }).find('.node-editor-model').exists()).toBe(false)
  })

  it('TC-G13c: không tra được nhãn ⇒ hiện thẳng runner id thay vì badge rỗng', () => {
    const w = mountNode({ ...STEP, runner_id: 'da-xoa' })
    expect(w.find('.node-editor-model').text()).toContain('da-xoa')
  })

  it('TC-G13d: không có provide nào (node dựng ngoài editor) ⇒ vẫn render, không throw', () => {
    const w = mountNode({ ...STEP, runner_id: 'r-gemini' }, null)
    expect(w.find('.node-editor-model').text()).toContain('r-gemini')
  })

  it('badge model không lẫn với dòng agent — hai class riêng', () => {
    const w = mountNode({ ...STEP, runner_id: 'r-gemini' })
    expect(w.find('.node-editor-agent').text()).toBe('dev-agent-teams:reviewer')
    expect(w.find('.node-editor-model').text()).not.toContain('dev-agent-teams')
  })
})
