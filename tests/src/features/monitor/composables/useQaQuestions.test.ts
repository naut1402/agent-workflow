import { describe, expect, it } from 'vitest'
import { parseQaBlocks, applyAnswer } from '@/features/monitor/composables/useQaQuestions'

describe('useQaQuestions — parseQaBlocks', () => {
  it('returns choices for a block with the "**Lựa chọn:**" convention', () => {
    const source = [
      '## Q1 — Hook nào?',
      '',
      'Mô tả câu hỏi.',
      '',
      '**Lựa chọn:**',
      '- A. Dùng onMounted',
      '- B. Dùng mixin',
      '',
      '**Trả lời:**',
      '',
    ].join('\n')

    const [block] = parseQaBlocks(source)
    expect(block.questionId).toBe('Q1')
    expect(block.choices).toEqual([
      { label: 'A', text: 'Dùng onMounted' },
      { label: 'B', text: 'Dùng mixin' },
    ])
  })

  it('returns no choices for a free-text block (legacy qa.md, no convention)', () => {
    const source = '## Q4 — Dùng mixin?\n\nPhân tích dài...\n\n**Trả lời:**\n'
    const [block] = parseQaBlocks(source)
    expect(block.questionId).toBe('Q4')
    expect(block.choices).toEqual([])
  })

  it('splits multiple questions into independent blocks', () => {
    const source = [
      '## Q1 — Câu 1',
      '',
      '**Lựa chọn:**',
      '- A. X',
      '',
      '**Trả lời:**',
      '',
      '## Q2 — Câu 2',
      '',
      'Free text, không có lựa chọn.',
      '',
      '**Trả lời:**',
      '',
    ].join('\n')

    const blocks = parseQaBlocks(source)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].questionId).toBe('Q1')
    expect(blocks[0].choices).toHaveLength(1)
    expect(blocks[1].questionId).toBe('Q2')
    expect(blocks[1].choices).toEqual([])
  })
})

describe('useQaQuestions — applyAnswer', () => {
  it('writes the answer into the target block only, leaving others untouched', () => {
    const source = [
      '## Q1 — Câu 1',
      '',
      '**Lựa chọn:**',
      '- A. X',
      '- B. Y',
      '',
      '**Trả lời:**',
      '',
      '## Q2 — Câu 2',
      '',
      'Free text.',
      '',
      '**Trả lời:**',
      '',
    ].join('\n')

    const next = applyAnswer(source, 0, 'X')

    expect(next).toContain('## Q1 — Câu 1')
    expect(next).toContain('**Trả lời:** X')
    // Q2's answer line must remain empty — untouched.
    const q2 = next.split(/^(?=##\s)/m)[1]
    expect(q2).toMatch(/\*\*Trả lời:\*\*\s*$/m)
  })

  it('appends a "**Trả lời:**" line when the block has none yet', () => {
    const source = '## Q1 — Câu 1\n\n**Lựa chọn:**\n- A. X\n'
    const next = applyAnswer(source, 0, 'X')
    expect(next).toMatch(/\*\*Trả lời:\*\*\s*X/)
  })

  it('is a no-op for an out-of-range block index', () => {
    const source = '## Q1 — Câu 1\n\n**Trả lời:**\n'
    expect(applyAnswer(source, 5, 'X')).toBe(source)
  })
})
