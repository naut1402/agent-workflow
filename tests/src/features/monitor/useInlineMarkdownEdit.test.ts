import { describe, it, expect } from 'vitest'
import {
  splitMarkdownSections,
  joinMarkdownSections,
} from '../../../../src/features/monitor/composables/useInlineMarkdownEdit'

describe('splitMarkdownSections', () => {
  it('splits on H2 headings', () => {
    const source = '# Title\n\n## One\n\nA\n\n## Two\n\nB'
    expect(splitMarkdownSections(source)).toEqual([
      '# Title\n\n',
      '## One\n\nA\n\n',
      '## Two\n\nB',
    ])
  })

  it('returns empty for blank source', () => {
    expect(splitMarkdownSections('   ')).toEqual([])
  })
})

describe('joinMarkdownSections', () => {
  it('joins sections with blank line', () => {
    expect(joinMarkdownSections(['## A\n\nx', '## B\n\ny'])).toBe('## A\n\nx\n\n## B\n\ny')
  })
})
