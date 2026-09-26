import { describe, expect, it } from 'vitest'
import {
  AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  readArtifactSectionDefault,
  resolveArtifactSectionAccordion,
  resolveArtifactSectionDefault,
  resolveArtifactViewMode,
  resolveChatEnterToSend,
  resolveChatFeedbackMode,
  resolveCollapseAppSidebarOnOutside,
  resolveCollapseMonitorSubSidebarOnOutside,
  resolveCollapseTaskExpandOnOutside,
  resolveHideMissingArtifacts,
  resolveNotificationsEnabled,
  resolveNotifyBrowserEnabled,
  resolveNotifyHitlPending,
  resolveNotifyQaReady,
  resolveNotificationUiPlacement,
  resolveNotifyShowFloating,
  resolveNotifyShowSidebar,
  resolveNotifySoundEnabled,
  resolveThemePreference,
} from '@/frontend/configs/appSettings'

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

describe('resolveNotifyShowSidebar / resolveNotifyShowFloating', () => {
  it('missing → both surfaces on (placement both)', () => {
    expect(resolveNotifyShowSidebar({})).toBe(true)
    expect(resolveNotifyShowFloating({})).toBe(true)
    expect(resolveNotifyShowSidebar(undefined)).toBe(true)
    expect(resolveNotifyShowFloating(null)).toBe(true)
  })

  it('sidebar → only sidebar', () => {
    expect(resolveNotifyShowSidebar({ notificationUiPlacement: 'sidebar' })).toBe(true)
    expect(resolveNotifyShowFloating({ notificationUiPlacement: 'sidebar' })).toBe(false)
  })

  it('floating → only floating', () => {
    expect(resolveNotifyShowSidebar({ notificationUiPlacement: 'floating' })).toBe(false)
    expect(resolveNotifyShowFloating({ notificationUiPlacement: 'floating' })).toBe(true)
  })

  it('both → both surfaces', () => {
    expect(resolveNotifyShowSidebar({ notificationUiPlacement: 'both' })).toBe(true)
    expect(resolveNotifyShowFloating({ notificationUiPlacement: 'both' })).toBe(true)
  })
})

describe('resolveNotificationUiPlacement', () => {
  it('missing / invalid → both', () => {
    expect(resolveNotificationUiPlacement({})).toBe('both')
    expect(resolveNotificationUiPlacement(undefined)).toBe('both')
  })

  it('keeps sidebar / floating / both', () => {
    expect(resolveNotificationUiPlacement({ notificationUiPlacement: 'sidebar' })).toBe('sidebar')
    expect(resolveNotificationUiPlacement({ notificationUiPlacement: 'floating' })).toBe('floating')
    expect(resolveNotificationUiPlacement({ notificationUiPlacement: 'both' })).toBe('both')
  })
})

describe('resolveChatFeedbackMode', () => {
  it('missing / invalid → queue (safe default)', () => {
    expect(resolveChatFeedbackMode({})).toBe('queue')
    expect(resolveChatFeedbackMode(undefined)).toBe('queue')
    expect(resolveChatFeedbackMode({ chatFeedbackMode: 'bogus' as any })).toBe('queue')
  })

  it('keeps immediate when set', () => {
    expect(resolveChatFeedbackMode({ chatFeedbackMode: 'immediate' })).toBe('immediate')
  })

  it('parseAppSettings preserves both valid values, not just what the resolver defaults to', () => {
    expect(parseAppSettings({ chatFeedbackMode: 'queue' })).toEqual({ chatFeedbackMode: 'queue' })
    expect(parseAppSettings({ chatFeedbackMode: 'immediate' })).toEqual({ chatFeedbackMode: 'immediate' })
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

describe('resolveChatEnterToSend', () => {
  it('missing → true (keeps the previous Enter-sends behaviour)', () => {
    expect(resolveChatEnterToSend({})).toBe(true)
    expect(resolveChatEnterToSend(undefined)).toBe(true)
    expect(resolveChatEnterToSend(null)).toBe(true)
  })

  it('only an explicit false switches Enter to newline', () => {
    expect(resolveChatEnterToSend({ chatEnterToSend: false })).toBe(false)
    expect(resolveChatEnterToSend({ chatEnterToSend: true })).toBe(true)
  })

  it('a non-boolean stored value falls back to sending', () => {
    expect(resolveChatEnterToSend({ chatEnterToSend: 'nope' as any })).toBe(true)
  })

  it('parseAppSettings round-trips both values', () => {
    expect(parseAppSettings({ chatEnterToSend: false })).toEqual({ chatEnterToSend: false })
    expect(parseAppSettings({ chatEnterToSend: true })).toEqual({ chatEnterToSend: true })
  })
})

/**
 * T0c6725e9 — trạng thái section mặc định của tài liệu markdown.
 *
 * Ba resolver, ba câu hỏi khác nhau, và đây là chỗ dễ lẫn nhất của task:
 * - `resolveArtifactSectionAccordion` — "chỉ mở một section" có đang bật không (thiếu khoá ⇒ BẬT).
 * - `readArtifactSectionDefault` — người dùng đã CHỌN gì (thiếu khoá ⇒ 'expanded'); control Settings bind vào đây.
 * - `resolveArtifactSectionDefault` — viewer thực sự áp gì; accordion bật thì luôn 'collapsed'.
 *
 * Tầng này là cổng chính cho TC-06, TC-17, TC-18: ép ở GIÁ TRỊ HIỆU DỤNG chứ không
 * ghi đè giá trị đã lưu — nên bật rồi tắt accordion phải trả lại đúng lựa chọn cũ.
 */
describe('resolveArtifactSectionAccordion (AC-2a)', () => {
  it('TC-01/TC-20: thiếu khoá ⇒ accordion BẬT — người dùng mới thấy tài liệu đóng hết', () => {
    expect(resolveArtifactSectionAccordion({})).toBe(true)
    expect(resolveArtifactSectionAccordion(undefined)).toBe(true)
    expect(resolveArtifactSectionAccordion(null)).toBe(true)
  })

  // E3: vắng mặt ≠ đặt `false`. Hai trạng thái này cho hành vi NGƯỢC nhau.
  it('TC-20: chỉ `false` tường minh mới tắt accordion', () => {
    expect(resolveArtifactSectionAccordion({ artifactSectionAccordion: false })).toBe(false)
    expect(resolveArtifactSectionAccordion({ artifactSectionAccordion: true })).toBe(true)
  })

  it('TC-03c: giá trị sai kiểu lọt qua passthrough ⇒ vẫn về fallback BẬT, không throw', () => {
    expect(resolveArtifactSectionAccordion({ artifactSectionAccordion: 'yes' as any })).toBe(true)
    expect(resolveArtifactSectionAccordion({ artifactSectionAccordion: 1 as any })).toBe(true)
    expect(resolveArtifactSectionAccordion({ artifactSectionAccordion: null as any })).toBe(true)
  })
})

describe('readArtifactSectionDefault — giá trị ĐÃ LƯU (AC-1)', () => {
  it('TC-18: thiếu khoá ⇒ fallback "mở tất cả"', () => {
    expect(readArtifactSectionDefault({})).toBe('expanded')
    expect(readArtifactSectionDefault(undefined)).toBe('expanded')
    expect(readArtifactSectionDefault(null)).toBe('expanded')
  })

  it('giữ nguyên cả hai giá trị hợp lệ', () => {
    expect(readArtifactSectionDefault({ artifactSectionDefault: 'collapsed' })).toBe('collapsed')
    expect(readArtifactSectionDefault({ artifactSectionDefault: 'expanded' })).toBe('expanded')
  })

  it('TC-03c: giá trị rác ⇒ "mở tất cả"', () => {
    expect(readArtifactSectionDefault({ artifactSectionDefault: 'open' as any })).toBe('expanded')
    expect(readArtifactSectionDefault({ artifactSectionDefault: null as any })).toBe('expanded')
    expect(readArtifactSectionDefault({ artifactSectionDefault: 3 as any })).toBe('expanded')
  })

  /**
   * TC chốt của E10: hàm này KHÔNG được biết tới accordion. Nếu nó cũng bị ép thì
   * control Settings hiện "đóng tất cả" trong lúc accordion bật (TC-02 đỏ), và
   * đường "bật rồi tắt" làm mất im lặng giá trị cũ của người dùng (TC-17 đỏ).
   */
  it('TC-17/TC-18: accordion BẬT không ép được giá trị đã lưu', () => {
    expect(
      readArtifactSectionDefault({
        artifactSectionDefault: 'expanded',
        artifactSectionAccordion: true,
      } as any),
    ).toBe('expanded')
    expect(readArtifactSectionDefault({ artifactSectionAccordion: true } as any)).toBe('expanded')
  })
})

describe('resolveArtifactSectionDefault — giá trị HIỆU DỤNG (AC-2b)', () => {
  it('TC-01: cài đặt sạch ⇒ "đóng tất cả" (accordion mặc định bật ép AC-1)', () => {
    expect(resolveArtifactSectionDefault({})).toBe('collapsed')
    expect(resolveArtifactSectionDefault(undefined)).toBe('collapsed')
    expect(resolveArtifactSectionDefault(null)).toBe('collapsed')
  })

  it('TC-15/TC-17: accordion bật ⇒ "đóng tất cả" DÙ đã lưu "mở tất cả"', () => {
    expect(
      resolveArtifactSectionDefault({
        artifactSectionAccordion: true,
        artifactSectionDefault: 'expanded',
      }),
    ).toBe('collapsed')
  })

  it('TC-04/TC-05: accordion tắt ⇒ trả đúng giá trị đã lưu', () => {
    expect(
      resolveArtifactSectionDefault({
        artifactSectionAccordion: false,
        artifactSectionDefault: 'expanded',
      }),
    ).toBe('expanded')
    expect(
      resolveArtifactSectionDefault({
        artifactSectionAccordion: false,
        artifactSectionDefault: 'collapsed',
      }),
    ).toBe('collapsed')
  })

  it('TC-04: accordion tắt + thiếu khoá AC-1 ⇒ "mở tất cả"', () => {
    expect(resolveArtifactSectionDefault({ artifactSectionAccordion: false })).toBe('expanded')
  })

  // TC-06: chỉ khi accordion TẮT thì fallback "luôn mở" của AC-1 mới lộ ra ở mức hành vi.
  it('TC-06: accordion tắt + giá trị AC-1 rác ⇒ "mở tất cả", không phải đóng hết', () => {
    for (const bad of ['open', 'OPEN', null, 0, {}]) {
      expect(
        resolveArtifactSectionDefault({
          artifactSectionAccordion: false,
          artifactSectionDefault: bad as any,
        }),
      ).toBe('expanded')
    }
  })
})

describe('AppSettingsSchema — khoá artifactSection* (T0c6725e9)', () => {
  it('round-trip cả hai khoá mới', () => {
    expect(
      parseAppSettings({ artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' }),
    ).toEqual({ artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' })
    expect(
      parseAppSettings({ artifactSectionAccordion: true, artifactSectionDefault: 'expanded' }),
    ).toEqual({ artifactSectionAccordion: true, artifactSectionDefault: 'expanded' })
  })

  /**
   * TC-03b/c: JSON hợp lệ nhưng sai kiểu ⇒ `safeParse` fail ⇒ về DEFAULT rỗng, và
   * từ đó cả ba resolver đi đúng đường của "vắng mặt" (accordion bật, đóng hết).
   */
  it('TC-03: sai kiểu ⇒ rơi về DEFAULT, cùng đường với "vắng mặt"', () => {
    expect(parseAppSettings({ artifactSectionDefault: 'open' })).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings({ artifactSectionAccordion: 'yes' })).toEqual(DEFAULT_APP_SETTINGS)

    const fallback = parseAppSettings({ artifactSectionAccordion: 1 })
    expect(resolveArtifactSectionAccordion(fallback)).toBe(true)
    expect(resolveArtifactSectionDefault(fallback)).toBe('collapsed')
    expect(readArtifactSectionDefault(fallback)).toBe('expanded')
  })

  it('bản cũ không có 2 khoá mới vẫn parse được', () => {
    expect(AppSettingsSchema.safeParse({ theme: 'dark' }).success).toBe(true)
  })
})
