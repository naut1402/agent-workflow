import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyThemeToDocument,
  resolveThemeToDataAttr,
  watchSystemTheme,
} from '../../../../src/core/lib/theme'

describe('resolveThemeToDataAttr', () => {
  it('maps light / dark directly', () => {
    expect(resolveThemeToDataAttr('light')).toBe('light')
    expect(resolveThemeToDataAttr('dark')).toBe('dark')
  })

  it('system follows matchMedia prefers-color-scheme', () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    vi.stubGlobal('matchMedia', matchMedia)
    expect(resolveThemeToDataAttr('system')).toBe('dark')

    matchMedia.mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    expect(resolveThemeToDataAttr('system')).toBe('light')
  })
})

describe('applyThemeToDocument', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute('data-theme')
  })

  it('sets data-theme from preference string', () => {
    applyThemeToDocument('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    applyThemeToDocument('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('resolves settings.theme missing → system → OS', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      media: '',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    applyThemeToDocument({})
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('watchSystemTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('subscribes and unsubscribes change listener', () => {
    const add = vi.fn()
    const remove = vi.fn()
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '',
      addEventListener: add,
      removeEventListener: remove,
    }))
    const onChange = vi.fn()
    const stop = watchSystemTheme(onChange)
    expect(add).toHaveBeenCalledWith('change', expect.any(Function))
    stop()
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
