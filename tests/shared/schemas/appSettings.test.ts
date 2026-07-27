import { describe, expect, it } from 'vitest'
import {
  AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  resolveArtifactViewMode,
  resolveCollapseAppSidebarOnOutside,
  resolveCollapseMonitorSubSidebarOnOutside,
  resolveCollapseTaskExpandOnOutside,
  resolveHideMissingArtifacts,
  resolveNotificationsEnabled,
  resolveNotifyBrowserEnabled,
  resolveNotifyHitlPending,
  resolveNotifyQaReady,
  resolveNotifySoundEnabled,
  resolveThemePreference,
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

describe('resolveThemePreference', () => {
  it('missing → system', () => {
    expect(resolveThemePreference({})).toBe('system')
    expect(resolveThemePreference(undefined)).toBe('system')
    expect(resolveThemePreference(null)).toBe('system')
  })

  it('keeps light / dark / system', () => {
    expect(resolveThemePreference({ theme: 'light' })).toBe('light')
    expect(resolveThemePreference({ theme: 'dark' })).toBe('dark')
    expect(resolveThemePreference({ theme: 'system' })).toBe('system')
  })
})

describe('resolveHideMissingArtifacts', () => {
  it('missing / undefined / null → true (hide by default)', () => {
    expect(resolveHideMissingArtifacts({})).toBe(true)
    expect(resolveHideMissingArtifacts(undefined)).toBe(true)
    expect(resolveHideMissingArtifacts(null)).toBe(true)
  })

  it('explicit true → true', () => {
    expect(resolveHideMissingArtifacts({ hideMissingArtifacts: true })).toBe(true)
  })

  it('explicit false → false', () => {
    expect(resolveHideMissingArtifacts({ hideMissingArtifacts: false })).toBe(false)
  })
})

describe('resolveCollapseTaskExpandOnOutside', () => {
  it('missing / undefined / null → false (off by default)', () => {
    expect(resolveCollapseTaskExpandOnOutside({})).toBe(false)
    expect(resolveCollapseTaskExpandOnOutside(undefined)).toBe(false)
    expect(resolveCollapseTaskExpandOnOutside(null)).toBe(false)
  })

  it('explicit true → true', () => {
    expect(resolveCollapseTaskExpandOnOutside({ collapseTaskExpandOnOutside: true })).toBe(true)
  })

  it('explicit false → false', () => {
    expect(resolveCollapseTaskExpandOnOutside({ collapseTaskExpandOnOutside: false })).toBe(false)
  })
})

describe('resolveCollapseAppSidebarOnOutside', () => {
  it('missing → false', () => {
    expect(resolveCollapseAppSidebarOnOutside({})).toBe(false)
    expect(resolveCollapseAppSidebarOnOutside(undefined)).toBe(false)
  })

  it('explicit true → true', () => {
    expect(resolveCollapseAppSidebarOnOutside({ collapseAppSidebarOnOutside: true })).toBe(true)
  })
})

describe('resolveCollapseMonitorSubSidebarOnOutside', () => {
  it('missing → false', () => {
    expect(resolveCollapseMonitorSubSidebarOnOutside({})).toBe(false)
  })

  it('explicit true → true', () => {
    expect(
      resolveCollapseMonitorSubSidebarOnOutside({ collapseMonitorSubSidebarOnOutside: true }),
    ).toBe(true)
  })
})

describe('resolveNotificationsEnabled', () => {
  it('missing → true (on by default)', () => {
    expect(resolveNotificationsEnabled({})).toBe(true)
    expect(resolveNotificationsEnabled(undefined)).toBe(true)
  })

  it('explicit false → false', () => {
    expect(resolveNotificationsEnabled({ notificationsEnabled: false })).toBe(false)
  })
})

describe('resolveNotifyHitlPending / resolveNotifyQaReady', () => {
  it('missing → true (on by default)', () => {
    expect(resolveNotifyHitlPending({})).toBe(true)
    expect(resolveNotifyQaReady({})).toBe(true)
  })

  it('explicit false → false', () => {
    expect(resolveNotifyHitlPending({ notifyHitlPending: false })).toBe(false)
    expect(resolveNotifyQaReady({ notifyQaReady: false })).toBe(false)
  })
})

describe('resolveNotifyBrowserEnabled / resolveNotifySoundEnabled', () => {
  it('missing → false (opt-in)', () => {
    expect(resolveNotifyBrowserEnabled({})).toBe(false)
    expect(resolveNotifySoundEnabled({})).toBe(false)
  })

  it('explicit true → true', () => {
    expect(resolveNotifyBrowserEnabled({ notifyBrowserEnabled: true })).toBe(true)
    expect(resolveNotifySoundEnabled({ notifySoundEnabled: true })).toBe(true)
  })
})

describe('AppSettingsSchema — new optional fields (mục 1, 7)', () => {
  it('safeParse succeeds on an old-shaped object missing the new fields', () => {
    const parsed = AppSettingsSchema.safeParse({ theme: 'dark' })
    expect(parsed.success).toBe(true)
  })

  it('accepts the new fields when present', () => {
    expect(
      parseAppSettings({
        hideMissingArtifacts: false,
        collapseTaskExpandOnOutside: true,
        collapseAppSidebarOnOutside: true,
        collapseMonitorSubSidebarOnOutside: true,
      }),
    ).toEqual({
      hideMissingArtifacts: false,
      collapseTaskExpandOnOutside: true,
      collapseAppSidebarOnOutside: true,
      collapseMonitorSubSidebarOnOutside: true,
    })
  })
})
