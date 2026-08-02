import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  useAppSettings,
} from '../../../../src/core/composables/useAppSettings'

beforeEach(() => {
  localStorage.clear()
  const { load } = useAppSettings()
  load()
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  const { load } = useAppSettings()
  load()
})

describe('useAppSettings', () => {
  it('defaults to empty object when key is missing', () => {
    const { settings } = useAppSettings()
    expect(settings.value).toEqual({})
  })

  it('persist / update writes JSON under the storage key', () => {
    const { settings, update, persist } = useAppSettings()
    update({ theme: 'dark' })
    expect(settings.value.theme).toBe('dark')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ theme: 'dark' })

    settings.value = { ...settings.value, artifactViewMode: 'block' }
    persist()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      theme: 'dark',
      artifactViewMode: 'block',
    })
  })

  it("update({ artifactViewMode: 'full' }) persists under storage key", () => {
    const { settings, update } = useAppSettings()
    update({ artifactViewMode: 'full' })
    expect(settings.value.artifactViewMode).toBe('full')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      artifactViewMode: 'full',
    })
  })

  it('corrupt JSON / invalid shape → default, no throw', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json')
    const { load, settings } = useAppSettings()
    expect(() => load()).not.toThrow()
    expect(settings.value).toEqual({})

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'neon' }))
    load()
    expect(settings.value).toEqual({})
  })

  it('getItem / setItem throw → swallow, no crash', () => {
    const { load, persist, settings, update } = useAppSettings()

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    })

    expect(() => load()).not.toThrow()
    expect(settings.value).toEqual({})
    expect(() => persist()).not.toThrow()
    expect(() => update({ theme: 'light' })).not.toThrow()
  })

  it('two callers share the same settings ref (singleton)', () => {
    const a = useAppSettings()
    const b = useAppSettings()
    expect(a.settings).toBe(b.settings)
    a.update({ theme: 'system' })
    expect(b.settings.value.theme).toBe('system')
  })

  it('update theme applies data-theme on documentElement', () => {
    const { update } = useAppSettings()
    update({ theme: 'light' })
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    update({ theme: 'dark' })
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
