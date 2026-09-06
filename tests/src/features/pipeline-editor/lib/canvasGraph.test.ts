import { describe, expect, it } from 'vitest'
import {
  buildEditorGraph,
  gateLabelOf,
  hasRemovalChange,
  isStepNode,
  stepEdgesOf,
  stepNodesOf,
} from '@/features/pipeline-editor/lib/canvasGraph'

function stepNode(id: string, extra: Record<string, any> = {}) {
  return { id, type: 'pipelineEditor', position: { x: 0, y: 0 }, data: {}, ...extra }
}

describe('canvasGraph — lọc node/edge phái sinh', () => {
  it('isStepNode chỉ nhận node type pipelineEditor', () => {
    expect(isStepNode(stepNode('a'))).toBe(true)
    expect(isStepNode({ id: 'art-a', type: 'artifact' })).toBe(false)
    expect(isStepNode(null)).toBe(false)
    expect(isStepNode({ id: 'x' })).toBe(false)
  })

  it('stepNodesOf loại node artifact khỏi danh sách step', () => {
    const nodes = [stepNode('a'), { id: 'art-a', type: 'artifact' }, stepNode('b')]
    expect(stepNodesOf(nodes).map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('stepNodesOf chịu được đầu vào rỗng / undefined', () => {
    expect(stepNodesOf([])).toEqual([])
    expect(stepNodesOf(undefined as any)).toEqual([])
  })

  it('stepEdgesOf chỉ giữ edge có cả 2 đầu là step (loại edge dữ liệu de-*)', () => {
    const edges = [
      { id: 'e-a-b', source: 'a', target: 'b' },
      { id: 'de-a-art-a', source: 'a', target: 'art-a' },
      { id: 'de-art-a-b', source: 'art-a', target: 'b' },
      { id: 'de-art-knowledge-a', source: 'art-knowledge', target: 'a' },
    ]
    const kept = stepEdgesOf(edges, new Set(['a', 'b']))
    expect(kept.map((e) => e.id)).toEqual(['e-a-b'])
  })
})

describe('canvasGraph — gateLabelOf', () => {
  it('trả gate_id khi hitl bật', () => {
    expect(gateLabelOf(stepNode('a', { data: { hitl: { mode: 'gate', gate_id: 'g1' } } }))).toBe('g1')
  })

  it('trả rỗng khi mode none / thiếu hitl / thiếu gate_id', () => {
    expect(gateLabelOf(stepNode('a', { data: { hitl: { mode: 'none', gate_id: 'g1' } } }))).toBe('')
    expect(gateLabelOf(stepNode('a', { data: {} }))).toBe('')
    expect(gateLabelOf(stepNode('a', { data: { hitl: { mode: 'gate' } } }))).toBe('')
    expect(gateLabelOf(null)).toBe('')
  })
})

describe('canvasGraph — buildEditorGraph', () => {
  const labels = { producesTitle: 'Đầu ra', knowledgeTitle: 'Knowledge' }

  it('gắn nhãn gate của step nguồn lên edge đi ra', () => {
    const stepNodes = [
      stepNode('a', { data: { hitl: { mode: 'gate', gate_id: 'design-approved' } } }),
      stepNode('b', { position: { x: 220, y: 60 } }),
    ]
    const { edges } = buildEditorGraph({
      stepNodes,
      stepEdges: [{ id: 'e-a-b', source: 'a', target: 'b' }],
      steps: [{ id: 'a' }, { id: 'b' }],
      labels,
    })
    const control = edges.find((e) => e.id === 'e-a-b')
    expect(control.label).toBe('design-approved')
    expect(control.labelStyle).toEqual({ fill: 'var(--muted)', fontWeight: 400 })
  })

  it('edge từ step không có gate mang nhãn rỗng', () => {
    const { edges } = buildEditorGraph({
      stepNodes: [stepNode('a'), stepNode('b')],
      stepEdges: [{ id: 'e-a-b', source: 'a', target: 'b' }],
      steps: [{ id: 'a' }, { id: 'b' }],
      labels,
    })
    expect(edges.find((e) => e.id === 'e-a-b').label).toBe('')
  })

  it('sinh node art-<stepId> cho step có produces và node art-knowledge cho knowledge_inputs', () => {
    const { nodes, edges } = buildEditorGraph({
      stepNodes: [stepNode('a'), stepNode('b', { position: { x: 220, y: 60 } })],
      stepEdges: [{ id: 'e-a-b', source: 'a', target: 'b' }],
      steps: [
        { id: 'a', produces: ['investigate.md'], knowledge_inputs: ['k1'] },
        { id: 'b', produces: [] },
      ],
      labels,
    })
    const ids = nodes.map((n) => n.id)
    expect(ids).toContain('art-a')
    expect(ids).toContain('art-knowledge')
    expect(ids).not.toContain('art-b')
    expect(edges.some((e) => e.id === 'de-a-art-a')).toBe(true)
  })

  it('editor không biết file có tồn tại hay không → mọi artifact là missing', () => {
    const { nodes } = buildEditorGraph({
      stepNodes: [stepNode('a')],
      stepEdges: [],
      steps: [{ id: 'a', produces: ['investigate.md'] }],
      labels,
    })
    const art = nodes.find((n) => n.id === 'art-a') as any
    expect(art.data.files).toEqual([{ name: 'investigate.md', exists: false }])
    expect(art.data.label).toBe('Đầu ra')
  })

  it('node phái sinh không kéo/chọn được', () => {
    const { nodes } = buildEditorGraph({
      stepNodes: [stepNode('a')],
      stepEdges: [],
      steps: [{ id: 'a', produces: ['x.md'] }],
      labels,
    })
    const art = nodes.find((n) => n.id === 'art-a') as any
    expect(art.draggable).toBe(false)
    expect(art.selectable).toBe(false)
  })

  // E4 — step tên trùng id node phái sinh: step thật thắng, không được ghi đè.
  it('bỏ artifact node (và edge của nó) khi id đụng id một step thật', () => {
    const { nodes, edges } = buildEditorGraph({
      stepNodes: [stepNode('a'), stepNode('art-a', { position: { x: 220, y: 60 } })],
      stepEdges: [{ id: 'e-a-art-a', source: 'a', target: 'art-a' }],
      steps: [{ id: 'a', produces: ['x.md'] }, { id: 'art-a' }],
      labels,
    })
    expect(nodes.filter((n) => n.id === 'art-a')).toHaveLength(1)
    expect(nodes.find((n) => n.id === 'art-a').type).toBe('pipelineEditor')
    expect(edges.some((e) => e.id === 'de-a-art-a')).toBe(false)
    expect(edges.some((e) => e.id === 'e-a-art-a')).toBe(true)
  })

  it('step node gốc luôn đi trước trong danh sách trả về', () => {
    const { nodes } = buildEditorGraph({
      stepNodes: [stepNode('a'), stepNode('b')],
      stepEdges: [],
      steps: [{ id: 'a', produces: ['x.md'] }, { id: 'b' }],
      labels,
    })
    expect(nodes.slice(0, 2).map((n) => n.id)).toEqual(['a', 'b'])
  })
})

// T1 — vị từ lọc change của VueFlow. Sync ở mọi change làm node giật lúc kéo,
// nên chỉ change `remove` mới được kích hoạt dựng lại graph phái sinh.
describe('hasRemovalChange', () => {
  it('true khi có ít nhất một change type "remove"', () => {
    expect(hasRemovalChange([{ type: 'remove', id: 'a' } as any])).toBe(true)
    expect(
      hasRemovalChange([
        { type: 'select', id: 'a' },
        { type: 'remove', id: 'b' },
      ] as any),
    ).toBe(true)
  })

  it('false khi chỉ có select / position / dimensions', () => {
    expect(
      hasRemovalChange([
        { type: 'select' },
        { type: 'position' },
        { type: 'dimensions' },
      ] as any),
    ).toBe(false)
  })

  it('false và không ném lỗi với mảng rỗng / null / undefined / phần tử null', () => {
    expect(hasRemovalChange([])).toBe(false)
    expect(hasRemovalChange(null)).toBe(false)
    expect(hasRemovalChange(undefined)).toBe(false)
    expect(hasRemovalChange([null, undefined])).toBe(false)
  })
})
