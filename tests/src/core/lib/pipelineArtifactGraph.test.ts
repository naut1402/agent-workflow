import { describe, expect, it } from 'vitest'
import { buildArtifactNodesAndEdges } from '@/core/lib/pipelineArtifactGraph'

const STEPS = [
  { id: 'investigator', produces: ['investigate.md'] },
  { id: 'designer', produces: ['design.md'] },
  { id: 'implementer', produces: ['phpstan.md'] },
  { id: 'reviewer', produces: ['review.md', 'test-spec.md'] },
  { id: 'pr-creator', produces: ['pr-desc.md'] },
]

function positionsFor(steps: { id: string }[]) {
  const pos: Record<string, { x: number; y: number }> = {}
  steps.forEach((s, i) => {
    pos[s.id] = { x: i * 200, y: 40 }
  })
  return pos
}

describe('buildArtifactNodesAndEdges', () => {
  it('gộp multi-produces thành 1 node art-<stepId> với exists map theo artifacts', () => {
    const { artifactNodes, dataFlowEdges } = buildArtifactNodesAndEdges({
      steps: STEPS,
      phasePositions: positionsFor(STEPS),
      artifacts: {
        'review.md': { exists: true },
        'test-spec.md': { exists: false },
      },
    })

    const reviewerArt = artifactNodes.find((n) => n.id === 'art-reviewer')
    expect(reviewerArt).toBeDefined()
    expect(reviewerArt!.type).toBe('artifact')
    expect(reviewerArt!.data.kind).toBe('produces')
    if (reviewerArt!.data.kind !== 'produces') return
    expect(reviewerArt!.data.files).toEqual([
      { name: 'review.md', exists: true },
      { name: 'test-spec.md', exists: false },
    ])
    expect(artifactNodes.filter((n) => n.id === 'art-reviewer')).toHaveLength(1)

    expect(dataFlowEdges.some((e) => e.id === 'de-reviewer-art-reviewer')).toBe(true)
    expect(dataFlowEdges.some((e) => e.id === 'de-art-reviewer-pr-creator')).toBe(true)
  })

  it('không tạo node khi step không có produces', () => {
    const steps = [
      { id: 'a', produces: ['a.md'] },
      { id: 'b' },
      { id: 'c', produces: ['c.md'] },
    ]
    const { artifactNodes } = buildArtifactNodesAndEdges({
      steps,
      phasePositions: positionsFor(steps),
    })
    expect(artifactNodes.map((n) => n.id)).toEqual(['art-a', 'art-c'])
  })

  it('produces: [] không tạo node thừa', () => {
    const steps = [{ id: 'empty', produces: [] }]
    const { artifactNodes, dataFlowEdges } = buildArtifactNodesAndEdges({
      steps,
      phasePositions: positionsFor(steps),
    })
    expect(artifactNodes).toEqual([])
    expect(dataFlowEdges).toEqual([])
  })

  it('tạo đúng 1 art-knowledge và edge fan-out tới consumer; không edge ngược', () => {
    const steps = [
      { id: 'investigator', produces: ['investigate.md'], knowledge_inputs: ['kb-a'] },
      { id: 'designer', produces: ['design.md'], knowledge_inputs: ['kb-b'] },
      { id: 'implementer', produces: ['phpstan.md'] },
    ]
    const { artifactNodes, dataFlowEdges } = buildArtifactNodesAndEdges({
      steps,
      phasePositions: positionsFor(steps),
    })

    const knowledge = artifactNodes.filter((n) => n.id === 'art-knowledge')
    expect(knowledge).toHaveLength(1)
    expect(knowledge[0].data.kind).toBe('knowledge')
    if (knowledge[0].data.kind !== 'knowledge') return
    expect(knowledge[0].data.entries).toEqual([
      { id: 'kb-a', stepId: 'investigator' },
      { id: 'kb-b', stepId: 'designer' },
    ])

    expect(dataFlowEdges.some((e) => e.id === 'de-art-knowledge-investigator')).toBe(true)
    expect(dataFlowEdges.some((e) => e.id === 'de-art-knowledge-designer')).toBe(true)
    expect(dataFlowEdges.every((e) => !(e.source !== 'art-knowledge' && e.target === 'art-knowledge'))).toBe(
      true,
    )
    expect(dataFlowEdges.filter((e) => e.target === 'art-knowledge')).toHaveLength(0)
  })

  it('chỉ trả data-flow edges (không có control-flow step→step)', () => {
    const { dataFlowEdges } = buildArtifactNodesAndEdges({
      steps: STEPS,
      phasePositions: positionsFor(STEPS),
    })
    expect(dataFlowEdges.every((e) => e.id.startsWith('de-'))).toBe(true)
    expect(dataFlowEdges.some((e) => e.id.startsWith('e-'))).toBe(false)
    expect(dataFlowEdges.every((e) => e.style.strokeDasharray === '4 4')).toBe(true)
  })

  it('step cuối có produces: có edge step→art, không có edge art→next', () => {
    const steps = [
      { id: 'a', produces: ['a.md'] },
      { id: 'last', produces: ['last.md'] },
    ]
    const { dataFlowEdges } = buildArtifactNodesAndEdges({
      steps,
      phasePositions: positionsFor(steps),
    })
    expect(dataFlowEdges.some((e) => e.id === 'de-last-art-last')).toBe(true)
    expect(dataFlowEdges.some((e) => e.source === 'art-last')).toBe(false)
  })

  it('filter phần tử produces rỗng / non-string; thiếu artifacts → exists false', () => {
    const steps = [{ id: 'x', produces: ['ok.md', '', 1, null, 'also.md'] as unknown[] }]
    const { artifactNodes } = buildArtifactNodesAndEdges({
      steps: steps as any,
      phasePositions: positionsFor(steps as any),
      artifacts: {},
    })
    const node = artifactNodes[0]
    expect(node.data.kind).toBe('produces')
    if (node.data.kind !== 'produces') return
    expect(node.data.files).toEqual([
      { name: 'ok.md', exists: false },
      { name: 'also.md', exists: false },
    ])
  })

  it('cùng KB id ở nhiều step → giữ từng dòng (id, stepId), không dedupe', () => {
    const steps = [
      { id: 'a', knowledge_inputs: ['shared'] },
      { id: 'b', knowledge_inputs: ['shared'] },
    ]
    const { artifactNodes } = buildArtifactNodesAndEdges({
      steps,
      phasePositions: positionsFor(steps),
    })
    const k = artifactNodes.find((n) => n.id === 'art-knowledge')!
    expect(k.data.kind).toBe('knowledge')
    if (k.data.kind !== 'knowledge') return
    expect(k.data.entries).toEqual([
      { id: 'shared', stepId: 'a' },
      { id: 'shared', stepId: 'b' },
    ])
  })
})
