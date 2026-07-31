import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '@shared/frontmatter'

describe('parseFrontmatter', () => {
  it('parses a leading YAML frontmatter block', () => {
    const raw = '---\nname: foo\ndescription: bar\n---\n# body'
    expect(parseFrontmatter(raw)).toEqual({ name: 'foo', description: 'bar' })
  })

  it('returns {} when there is no leading ---', () => {
    expect(parseFrontmatter('# just a heading\ntext')).toEqual({})
  })

  it('returns {} when the closing --- is missing', () => {
    expect(parseFrontmatter('---\nname: foo\n# no close')).toEqual({})
  })

  it('returns {} on invalid YAML instead of throwing', () => {
    expect(parseFrontmatter('---\n: : :\n---')).toEqual({})
  })

  it('handles CRLF line endings', () => {
    expect(parseFrontmatter('---\r\nname: foo\r\n---\r\nbody')).toEqual({ name: 'foo' })
  })

  it('returns {} for empty frontmatter', () => {
    expect(parseFrontmatter('---\n---\nbody')).toEqual({})
  })
})
