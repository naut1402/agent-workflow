import { describe, expect, test } from 'bun:test'
import { dedupeCatalogItems, sourcePriority } from '../../../../src/server/catalog/dedupe'

describe('sourcePriority', () => {
  test('ranks dashboard > project > plugin > repo > user > cursor > unknown', () => {
    expect(sourcePriority('dashboard')).toBe(55)
    expect(sourcePriority('project')).toBe(50)
    expect(sourcePriority('plugin:foo')).toBe(45)
    expect(sourcePriority('repo:bar')).toBe(40)
    expect(sourcePriority('user')).toBe(20)
    expect(sourcePriority('cursor')).toBe(10)
    expect(sourcePriority('whatever')).toBe(0)
  })
})

describe('dedupeCatalogItems', () => {
  test('keeps the highest-priority source on name collision', () => {
    const items = [
      { name: 'investigator', source: 'user' },
      { name: 'investigator', source: 'project' },
      { name: 'investigator', source: 'repo:x' },
    ]
    const out = dedupeCatalogItems(items)
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('project')
  })

  test('does not downgrade when a lower-priority source comes later', () => {
    const items = [
      { name: 'a', source: 'dashboard' },
      { name: 'a', source: 'user' },
    ]
    expect(dedupeCatalogItems(items)[0].source).toBe('dashboard')
  })

  test('sorts results by name', () => {
    const out = dedupeCatalogItems([
      { name: 'zeta', source: 'user' },
      { name: 'alpha', source: 'user' },
      { name: 'mid', source: 'user' },
    ])
    expect(out.map((i) => i.name)).toEqual(['alpha', 'mid', 'zeta'])
  })

  test('keeps distinct names', () => {
    const out = dedupeCatalogItems([
      { name: 'a', source: 'user' },
      { name: 'b', source: 'user' },
    ])
    expect(out).toHaveLength(2)
  })
})
