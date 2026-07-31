import { describe, expect, it } from 'vitest'
import { parseWorkflowMarkdown, compileWorkflowMarkdown } from '../../../../src/core/lib/workflowSteps'

describe('parseWorkflowMarkdown', () => {
  it('returns [] for empty input', () => {
    expect(parseWorkflowMarkdown('')).toEqual([])
    expect(parseWorkflowMarkdown('   ')).toEqual([])
  })

  it('parses ### headings, strips "Bước N:" prefix and pipeline_step comment', () => {
    const md = '### Bước 1: Khảo sát\n\nNội dung A\n<!-- pipeline_step:investigator -->\n\n### Thiết kế\n\nNội dung B'
    expect(parseWorkflowMarkdown(md)).toEqual([
      { title: 'Khảo sát', body: 'Nội dung A', pipelineStepId: 'investigator' },
      { title: 'Thiết kế', body: 'Nội dung B', pipelineStepId: '' },
    ])
  })

  it('parses a numbered list', () => {
    const out = parseWorkflowMarkdown('1. Một\n   chi tiết\n2. Hai')
    expect(out).toEqual([
      { title: 'Một', body: '   chi tiết', pipelineStepId: '' },
      { title: 'Hai', body: '', pipelineStepId: '' },
    ])
  })

  it('falls back to a single step for free text', () => {
    expect(parseWorkflowMarkdown('chỉ là văn bản')).toEqual([
      { title: 'Bước 1', body: 'chỉ là văn bản', pipelineStepId: '' },
    ])
  })
})

describe('compileWorkflowMarkdown', () => {
  it('drops empty steps and re-numbers with pipeline_step comment', () => {
    const md = compileWorkflowMarkdown([
      { title: 'A', body: 'body A', pipelineStepId: 'investigator' },
      { title: '', body: '' },
      { title: 'B', body: 'body B' },
    ])
    expect(md).toBe(
      '### Bước 1: A\n\nbody A\n\n<!-- pipeline_step:investigator -->\n\n### Bước 2: B\n\nbody B',
    )
  })

  it('roundtrips parse → compile → parse', () => {
    const md = '### Bước 1: X\n\nnội dung\n\n<!-- pipeline_step:reviewer -->'
    expect(parseWorkflowMarkdown(compileWorkflowMarkdown(parseWorkflowMarkdown(md)))).toEqual(
      parseWorkflowMarkdown(md),
    )
  })
})
