import { describe, expect, it } from 'vitest'
import { appendKnowledge, buildKnowledgeBlock } from '@/features/nl-chat/lib/knowledgePrompt'

// Sinh đôi của `attachmentPrompt`: khối này LÀ hợp đồng của tính năng "chọn
// knowledge cho khung chat" — chat gửi đường dẫn, agent tự mở file.

const ref = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id.split('/')[1],
  path: `/kho/${id}.md`,
  ...extra,
})

describe('buildKnowledgeBlock', () => {
  it('rỗng khi không chọn gì', () => {
    expect(buildKnowledgeBlock([])).toBe('')
  })

  it('mỗi entry một dòng, nêu rõ id và đường dẫn (TC-I19)', () => {
    const block = buildKnowledgeBlock([ref('project/a'), ref('global/b')])
    expect(block.split('\n')).toEqual([
      'Knowledge người dùng chỉ định (đọc trực tiếp từ đường dẫn):',
      '- a [project/a] → /kho/project/a.md',
      '- b [global/b] → /kho/global/b.md',
    ])
  })

  it('id không mở được thì bỏ hẳn dòng, không gửi đường dẫn rỗng (TC-I21)', () => {
    expect(buildKnowledgeBlock([{ id: 'project/mất', error: 'not found' }])).toBe('')
    const mixed = buildKnowledgeBlock([{ id: 'project/mất', error: 'not found' }, ref('project/a')])
    expect(mixed).toContain('project/a')
    expect(mixed).not.toContain('project/mất')
  })

  it('không có title thì rơi về id, không in "undefined"', () => {
    expect(buildKnowledgeBlock([{ id: 'project/a', path: '/kho/a.md' }])).toContain('- project/a [project/a]')
  })
})

describe('appendKnowledge', () => {
  it('giữ nguyên message khi không chọn gì (TC-I20)', () => {
    expect(appendKnowledge('xin chào', [])).toBe('xin chào')
  })

  it('nối sau message, cách một dòng trống', () => {
    const out = appendKnowledge('xin chào', [ref('project/a')])
    expect(out.startsWith('xin chào\n\nKnowledge người dùng chỉ định')).toBe(true)
  })

  it('message rỗng thì chỉ còn khối, không có dòng trống thừa ở đầu', () => {
    expect(appendKnowledge('', [ref('project/a')]).startsWith('Knowledge')).toBe(true)
  })
})
