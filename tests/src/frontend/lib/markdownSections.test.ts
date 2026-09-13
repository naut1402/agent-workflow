import { describe, expect, it } from 'vitest'
import {
  joinMarkdownSections,
  splitMarkdownSections,
} from '@/frontend/lib/markdownSections'
import * as inlineEdit from '@/features/monitor/composables/useInlineMarkdownEdit'

describe('splitMarkdownSections', () => {
  it('cắt theo heading cấp 2 và giữ nguyên dấu ## ở đầu mỗi phần', () => {
    expect(splitMarkdownSections('## A\n\na\n\n## B\n\nb')).toEqual([
      '## A\n\na\n\n',
      '## B\n\nb',
    ])
  })

  it('giữ phần trước heading đầu tiên làm một section riêng', () => {
    const parts = splitMarkdownSections('mở đầu\n\n## A\n\na')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain('mở đầu')
  })

  it('chuỗi trắng trả mảng rỗng', () => {
    expect(splitMarkdownSections('')).toEqual([])
    expect(splitMarkdownSections('   \n  ')).toEqual([])
  })

  it('### không phải mốc cắt, chỉ ## mới là', () => {
    expect(splitMarkdownSections('## A\n\n### A1\n\nx')).toHaveLength(1)
  })
})

describe('joinMarkdownSections', () => {
  it('ghép lại bằng một dòng trắng và bỏ phần rỗng', () => {
    expect(joinMarkdownSections(['## A', '', '## B'])).toBe('## A\n\n## B')
  })

  it('round-trip giữ đủ nội dung', () => {
    const src = '## A\n\na\n\n## B\n\nb'
    const out = joinMarkdownSections(splitMarkdownSections(src))
    for (const line of ['## A', '## B', 'a', 'b']) expect(out).toContain(line)
  })
})

// F6/F7: hàm đã chuyển sang frontend/lib, monitor chỉ re-export. Hợp đồng import
// cũ phải còn nguyên — đây là bằng chứng không phá consumer nào.
describe('re-export qua useInlineMarkdownEdit', () => {
  it('trỏ về đúng cùng một hàm', () => {
    expect(inlineEdit.splitMarkdownSections).toBe(splitMarkdownSections)
    expect(inlineEdit.joinMarkdownSections).toBe(joinMarkdownSections)
  })
})
