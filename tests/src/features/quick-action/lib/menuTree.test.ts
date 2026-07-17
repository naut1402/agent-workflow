import { describe, expect, it } from 'vitest'
import type { ArtifactMenuNode } from '@/features/quick-action/lib/menuTypes'
import {
  addMenuGroup,
  findActionMenuId,
  listMenuGroupOptions,
  setActionMenuMembership,
} from '@/features/quick-action/lib/menuTree'

const sample: ArtifactMenuNode[] = [
  {
    id: 'docs',
    label: 'Tài liệu',
    children: [
      { id: 'docs-improve', label: 'Cải thiện', action_id: 'improve-doc' },
      {
        id: 'docs-more',
        label: 'Thêm',
        children: [{ id: 'docs-summarize', label: 'Tóm tắt', action_id: 'summarize-doc' }],
      },
    ],
  },
]

describe('menuTree membership helpers', () => {
  it('findActionMenuId returns parent group or null', () => {
    expect(findActionMenuId(sample, 'improve-doc')).toBe('docs')
    expect(findActionMenuId(sample, 'summarize-doc')).toBe('docs-more')
    expect(findActionMenuId(sample, 'missing')).toBe(null)
  })

  it('listMenuGroupOptions lists only groups with depth', () => {
    expect(listMenuGroupOptions(sample)).toEqual([
      { id: 'docs', label: 'Tài liệu', depth: 0 },
      { id: 'docs-more', label: 'Thêm', depth: 1 },
    ])
  })

  it('setActionMenuMembership attaches under group and clears when independent', () => {
    const attached = setActionMenuMembership(sample, 'new-action', 'New', 'docs-more')
    expect(findActionMenuId(attached, 'new-action')).toBe('docs-more')
    expect(findActionMenuId(attached, 'improve-doc')).toBe('docs')

    const moved = setActionMenuMembership(attached, 'improve-doc', 'Cải thiện', 'docs-more')
    expect(findActionMenuId(moved, 'improve-doc')).toBe('docs-more')

    const independent = setActionMenuMembership(moved, 'improve-doc', 'Cải thiện', null)
    expect(findActionMenuId(independent, 'improve-doc')).toBe(null)
  })

  it('addMenuGroup nests under parent or roots', () => {
    const nested = addMenuGroup(sample, { id: 'nested', label: 'Nested', parentId: 'docs' })
    expect(listMenuGroupOptions(nested).map((o) => o.id)).toContain('nested')
    expect(listMenuGroupOptions(nested).find((o) => o.id === 'nested')?.depth).toBe(1)

    const rooted = addMenuGroup(sample, { id: 'root2', label: 'Root 2' })
    expect(rooted.some((n) => n.id === 'root2')).toBe(true)
  })
})
