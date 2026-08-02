import { describe, expect, it } from 'vitest'
import { asArray } from '@/core/lib/arrayUtils'
import { nowStamp } from '@/core/lib/dateUtils'
import { slugify, slugifySectionKey } from '@/core/lib/stringUtils'
import { dumpYaml, loadYaml } from '@/core/lib/yamlLib'

describe('stringUtils', () => {
  it('slugify strips diacritics and maps đ', () => {
    expect(slugify('Điều tra')).toBe('dieu-tra')
    expect(slugify('', { fallback: 'x' })).toBe('x')
  })

  it('slugifySectionKey caps length', () => {
    expect(slugifySectionKey('a'.repeat(40)).length).toBeLessThanOrEqual(32)
  })
})

describe('arrayUtils', () => {
  it('asArray coerces non-arrays to []', () => {
    expect(asArray([1])).toEqual([1])
    expect(asArray(null)).toEqual([])
    expect(asArray('x')).toEqual([])
  })
})

describe('dateUtils', () => {
  it('nowStamp returns ts + iso', () => {
    const d = new Date('2020-01-02T03:04:05.000Z')
    expect(nowStamp(d)).toEqual({ ts: d.getTime(), iso: d.toISOString() })
  })
})

describe('yamlLib', () => {
  it('round-trips object', () => {
    const raw = dumpYaml({ a: 1, b: ['x'] })
    expect(loadYaml(raw)).toEqual({ a: 1, b: ['x'] })
  })
})
