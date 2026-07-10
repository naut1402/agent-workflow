import { describe, expect, it } from 'vitest'
import {
  AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  resolveArtifactViewMode,
} from '../../../shared/schemas/appSettings'

describe('parseAppSettings', () => {
  it('returns default for null / undefined / non-object', () => {
    expect(parseAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings('x')).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings(42)).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('accepts empty object', () => {
    expect(parseAppSettings({})).toEqual({})
  })

  it('keeps known optional fields', () => {
    expect(parseAppSettings({ theme: 'dark', artifactViewMode: 'full' })).toEqual({
      theme: 'dark',
      artifactViewMode: 'full',
    })
  })

  it('passthrough keeps unknown keys on a valid object', () => {
    const parsed = AppSettingsSchema.safeParse({ theme: 'light', futureFlag: true })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.theme).toBe('light')
      expect((parsed.data as Record<string, unknown>).futureFlag).toBe(true)
    }
  })

  it('rejects invalid enum values → default', () => {
    expect(parseAppSettings({ theme: 'neon' })).toEqual(DEFAULT_APP_SETTINGS)
  })
})

describe('resolveArtifactViewMode', () => {
  it('TC-SC-01: {} / undefined / null → block', () => {
    expect(resolveArtifactViewMode({})).toBe('block')
    expect(resolveArtifactViewMode(undefined)).toBe('block')
    expect(resolveArtifactViewMode(null)).toBe('block')
  })

  it("TC-SC-02: { artifactViewMode: 'block' } → block", () => {
    expect(resolveArtifactViewMode({ artifactViewMode: 'block' })).toBe('block')
  })

  it("TC-SC-03: { artifactViewMode: 'full' } → full", () => {
    expect(resolveArtifactViewMode({ artifactViewMode: 'full' })).toBe('full')
  })
})
