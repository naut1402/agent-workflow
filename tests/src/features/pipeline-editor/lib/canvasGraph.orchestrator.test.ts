import { describe, expect, it } from 'vitest'
import { buildEditorGraph, stepEdgesOf, stepNodesOf } from '@/features/pipeline-editor/lib/canvasGraph'
import { ORCHESTRATOR_NODE_ID } from '@/frontend/lib/orchestratorNode'

// Node orchestrator sinh từ **meta** (khoá `orchestrator` của pipeline), không
// từ canvas. Bất biến quan trọng nhất: nó KHÔNG được lọt vào tập step, nếu
// không YAML lưu ra sẽ mọc một step rác `__orchestrator__`.

const LABELS = { producesTitle: 'produces', knowledgeTitle: 'knowledge' }

function stepNode(id: string, x: number) {
  return { id, type: 'pipelineEditor', position: { x, y: 40 }, data: {} }
}

function build(orchestrator: any, stepNodes = [stepNode('a', 0), stepNode('b', 400)]) {
  return buildEditorGraph({
    stepNodes,
    stepEdges: [{ id: 'e-a-b', source: 'a', target: 'b' }],
    steps: [],
    labels: LABELS,
    orchestrator,
    orchestratorLabel: 'Điều phối',
  })
}

describe('bật/tắt bằng meta (AC-2a)', () => {
  it('enabled ⇒ có đúng một node orchestrator', () => {
    const nodes = build({ enabled: true, agent: 'a:orch' }).nodes.filter((n: any) => n.id === ORCHESTRATOR_NODE_ID)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].data).toMatchObject({ label: 'Điều phối', agent: 'a:orch' })
  })

  it('không truyền meta ⇒ không có node (mặc định tắt)', () => {
    expect(build(undefined).nodes.some((n: any) => n.id === ORCHESTRATOR_NODE_ID)).toBe(false)
  })

  it('enabled: false ⇒ không có node (TC-02)', () => {
    expect(build({ enabled: false }).nodes.some((n: any) => n.id === ORCHESTRATOR_NODE_ID)).toBe(false)
  })

  it('enabled không phải boolean true ⇒ không có node', () => {
    for (const raw of ['yes', 1, null, {}]) {
      expect(build({ enabled: raw }).nodes.some((n: any) => n.id === ORCHESTRATOR_NODE_ID)).toBe(false)
    }
  })

  it('thiếu agent vẫn dựng được node (editor hiển thị "chưa chọn agent")', () => {
    const node = build({ enabled: true }).nodes.find((n: any) => n.id === ORCHESTRATOR_NODE_ID)
    expect(node.data.agent).toBe('')
  })
})

describe('không lọt vào YAML (TC-32)', () => {
  it('stepNodesOf bỏ qua node orchestrator', () => {
    const { nodes } = build({ enabled: true, agent: 'a:orch' })
    expect(stepNodesOf(nodes).map((n: any) => n.id)).toEqual(['a', 'b'])
  })

  it('type KHÔNG phải pipelineEditor — đó là thứ giữ nó ngoài tập step', () => {
    const node = build({ enabled: true }).nodes.find((n: any) => n.id === ORCHESTRATOR_NODE_ID)
    expect(node.type).toBe('orchestrator')
  })

  it('không có edge nào nối với step (nó không nằm trong steps[])', () => {
    const { nodes, edges } = build({ enabled: true })
    expect(edges.some((e: any) => e.source === ORCHESTRATOR_NODE_ID || e.target === ORCHESTRATOR_NODE_ID)).toBe(false)
    const stepIds = new Set(stepNodesOf(nodes).map((n: any) => n.id))
    expect(stepEdgesOf(edges, stepIds).map((e: any) => e.id)).toEqual(['e-a-b'])
  })

  it('dựng lại nhiều lần vẫn đúng một node (sync canvas ↔ YAML không nhân bản)', () => {
    for (let i = 0; i < 3; i++) {
      const nodes = build({ enabled: true }).nodes.filter((n: any) => n.id === ORCHESTRATOR_NODE_ID)
      expect(nodes).toHaveLength(1)
    }
  })
})

describe('không xoá được (TC-04)', () => {
  it('node khai deletable/draggable/selectable = false', () => {
    const node = build({ enabled: true }).nodes.find((n: any) => n.id === ORCHESTRATOR_NODE_ID)
    expect(node.deletable).toBe(false)
    expect(node.draggable).toBe(false)
    expect(node.selectable).toBe(false)
  })

  it('node step vẫn xoá được bình thường — canvas không bị khoá toàn cục', () => {
    const { nodes } = build({ enabled: true })
    for (const step of stepNodesOf(nodes)) {
      expect((step as any).deletable).toBeUndefined()
    }
  })
})

describe('vị trí (TC-05, TC-06)', () => {
  it('trên cùng, căn giữa dải step', () => {
    const node = build({ enabled: true }).nodes.find((n: any) => n.id === ORCHESTRATOR_NODE_ID)
    expect(node.position.x).toBe(200)
    expect(node.position.y).toBeLessThan(40)
  })

  it('pipeline 0 step ⇒ vẫn dựng được, toạ độ không NaN', () => {
    const { nodes } = buildEditorGraph({
      stepNodes: [],
      stepEdges: [],
      steps: [],
      labels: LABELS,
      orchestrator: { enabled: true },
    })
    const node = nodes.find((n: any) => n.id === ORCHESTRATOR_NODE_ID)
    expect(node).toBeTruthy()
    expect(Number.isFinite(node.position.x)).toBe(true)
    expect(Number.isFinite(node.position.y)).toBe(true)
  })
})
