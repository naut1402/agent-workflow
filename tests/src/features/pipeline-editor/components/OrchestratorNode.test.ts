import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import OrchestratorNode from '@/features/pipeline-editor/components/OrchestratorNode.vue'

// T8eb14482 — TC-UI-01: node điều phối có nút "chỉnh sửa" riêng biệt, click
// vào phải emit 'edit' để `PipelineEditor.vue` mở dialog cấu hình.

// `<Handle>` (`@vue-flow/core`) chỉ hoạt động bên trong context VueFlow thật
// (tra `useVueFlow()` theo id node) — không có context đó thì mount ném lỗi.
// Node component ở đây được test độc lập với canvas, nên stub `Handle`.
function mountNode(data: Record<string, unknown> = { label: 'Điều phối', agent: 'a:orch' }) {
  return mountWithI18n(OrchestratorNode, {
    props: { data },
    global: { stubs: { Handle: true } },
  })
}

describe('OrchestratorNode', () => {
  it('TC-UI-01: hiển thị nút chỉnh sửa (✎) riêng biệt trên node', () => {
    const w = mountNode()
    const btn = w.find('button.node-btn')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('✎')
  })

  it('click nút chỉnh sửa ⇒ emit "edit"', async () => {
    const w = mountNode()
    await w.find('button.node-btn').trigger('click')
    expect(w.emitted('edit')).toHaveLength(1)
  })

  it('render đúng label và agent đã cấu hình', () => {
    const w = mountNode({ label: 'Điều phối', agent: 'a:orch' })
    expect(w.text()).toContain('Điều phối')
    expect(w.text()).toContain('a:orch')
  })

  it('chưa chọn agent ⇒ hiện trạng thái "chưa chọn agent" thay vì rỗng', () => {
    const w = mountNode({ label: 'Điều phối' })
    expect(w.find('.onode-agent--missing').exists()).toBe(true)
  })
})
