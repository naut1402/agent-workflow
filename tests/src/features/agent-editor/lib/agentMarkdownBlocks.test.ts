import { describe, expect, it } from 'vitest'
import {
  buildAgentBlocks,
  fenceYaml,
  splitFrontmatter,
} from '@/features/agent-editor/lib/agentMarkdownBlocks'

const WITH_FM = `---
name: reviewer
model: claude-opus-5
---

## Role

Review code.

## Skills

- lint
`

describe('splitFrontmatter', () => {
  it('tách khối --- … --- ở đầu file khỏi body', () => {
    const { frontmatter, body } = splitFrontmatter(WITH_FM)
    expect(frontmatter).toBe('---\nname: reviewer\nmodel: claude-opus-5\n---')
    expect(body.startsWith('## Role')).toBe(true)
    expect(body).not.toContain('name: reviewer')
  })

  it('không có frontmatter thì trả nguyên văn làm body', () => {
    const src = '## Role\n\nbody'
    expect(splitFrontmatter(src)).toEqual({ frontmatter: null, body: src })
  })

  // E9: mở mà không đóng — không được nuốt cả file vào một khối code.
  it('mở --- mà không đóng thì coi cả file là body', () => {
    const src = '---\nname: broken\n\n## Role\n\nbody'
    expect(splitFrontmatter(src)).toEqual({ frontmatter: null, body: src })
  })

  it('chuỗi rỗng không ném lỗi', () => {
    expect(splitFrontmatter('')).toEqual({ frontmatter: null, body: '' })
  })
})

describe('buildAgentBlocks', () => {
  it('frontmatter thành block riêng, phần còn lại cắt theo ##', () => {
    const blocks = buildAgentBlocks(WITH_FM)
    expect(blocks.map((b) => [b.kind, b.heading])).toEqual([
      ['frontmatter', null],
      ['section', 'Role'],
      ['section', 'Skills'],
    ])
  })

  // TC-30: nội dung phẳng, không heading ## nào — không được nuốt mất.
  it('không có heading ## thì vẫn trả đủ nội dung trong một block không tiêu đề', () => {
    const blocks = buildAgentBlocks('Chỉ là văn bản phẳng.\n\n# H1 thôi')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].heading).toBeNull()
    expect(blocks[0].kind).toBe('section')
    expect(blocks[0].source).toContain('Chỉ là văn bản phẳng.')
    expect(blocks[0].source).toContain('# H1 thôi')
  })

  // E8: không frontmatter ⇒ không có block Metadata.
  it('không có frontmatter thì không sinh block kind=frontmatter', () => {
    const blocks = buildAgentBlocks('## A\n\na\n\n## B\n\nb')
    expect(blocks.every((b) => b.kind === 'section')).toBe(true)
    expect(blocks.map((b) => b.heading)).toEqual(['A', 'B'])
  })

  // TC-31 + TC-29: ghép lại các block phải bằng nguồn — không mất chữ.
  it('giữ nguyên thứ tự và không mất nội dung khi ghép ngược lại', () => {
    const blocks = buildAgentBlocks(WITH_FM)
    const rejoined = blocks.map((b) => b.source.trim()).join('\n\n')
    for (const line of ['name: reviewer', '## Role', 'Review code.', '## Skills', '- lint']) {
      expect(rejoined).toContain(line)
    }
  })

  // TC-31: luật cắt không phân biệt code fence — parity với viewer sẵn có của repo.
  it('cắt section không phân biệt code fence, nhưng không mất chữ', () => {
    const src = '## A\n\n```md\n## trong fence\n```\n'
    const blocks = buildAgentBlocks(src)
    expect(blocks).toHaveLength(2)
    expect(blocks.map((b) => b.source).join('')).toContain('## trong fence')
  })

  it('nội dung rỗng trả về mảng rỗng', () => {
    expect(buildAgentBlocks('')).toEqual([])
  })
})

describe('fenceYaml', () => {
  it('bọc frontmatter thành fence yaml để marked không dựng thành <hr>', () => {
    expect(fenceYaml('---\na: 1\n---')).toBe('```yaml\n---\na: 1\n---\n```')
  })
})
