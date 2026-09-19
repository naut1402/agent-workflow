import { describe, expect, it } from 'vitest'
import { createTestI18n } from '../../helpers/i18n'
import vi from '@/features/monitor/locales/vi'
import en from '@/features/monitor/locales/en'

// Td16ee130 — nhóm D của `test-spec.md`: nhãn của hai dialog (duyệt nội dung,
// reset step) phải đi qua i18n ở CẢ hai locale, và tập key hai bên phải bằng
// nhau. Thiếu key ở `en` thì vue-i18n fallback âm thầm về tiếng Việt — người
// dùng `en` thấy một dialog nửa Việt nửa Anh mà không có lỗi nào phát ra.

/** Nhãn mới của hai dialog, theo `design.md` §4.1 F6/F7. */
const DIALOG_KEYS = [
  'monitor.pipeline.decisionApprove',
  'monitor.pipeline.decisionReject',
  'monitor.pipeline.feedbackLabel',
  'monitor.pipeline.confirm',
  'monitor.pipeline.cancel',
  'monitor.pipeline.resetScopeToggle',
  'monitor.pipeline.resetScopeStep',
  'monitor.pipeline.resetScopeOnward',
  'monitor.pipeline.deleteScopeToggle',
  'monitor.pipeline.deleteScopeStep',
  'monitor.pipeline.deleteScopeOnward',
  'monitor.pipeline.deleteScopeOnwardBlocked',
  'monitor.pipeline.resetSubmit',
  'monitor.pipeline.resetConfirmHeading',
  'monitor.pipeline.resetConfirmBody',
  'monitor.pipeline.resetConfirmDeleteWarning',
]

/** Key của cơ chế cũ — còn sót lại là nợ chết, không phải chi tiết. */
const REMOVED_KEYS = ['approve', 'reject', 'resetConfirmOnlyThis', 'resetConfirmCascade', 'resetConfirmCascadeBody']

describe.each(['vi', 'en'] as const)('TC-D05: nhãn hai dialog — locale %s', (locale) => {
  const t = (key: string) => (createTestI18n(locale).global as any).t(key)

  it.each(DIALOG_KEYS)('%s có bản dịch riêng của locale', (key) => {
    const value = t(key)
    // vue-i18n trả lại chính khoá khi thiếu bản dịch — đó là lỗi cần bắt.
    expect(value).not.toBe(key)
    expect(String(value).trim().length).toBeGreaterThan(0)
  })
})

describe('TC-D06: parity key giữa vi và en', () => {
  function keysOf(node: unknown, prefix = ''): string[] {
    if (node === null || typeof node !== 'object') return [prefix]
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      keysOf(v, prefix ? `${prefix}.${k}` : k),
    )
  }

  it('tập key của khối `pipeline` bằng nhau hai bên — không key thừa, không key thiếu', () => {
    const viKeys = keysOf((vi as any).pipeline).sort()
    const enKeys = keysOf((en as any).pipeline).sort()
    expect(enKeys).toEqual(viKeys)
  })

  it.each(REMOVED_KEYS)('key `%s` của cơ chế cũ đã bị dọn ở cả hai locale', (key) => {
    expect((vi as any).pipeline).not.toHaveProperty(key)
    expect((en as any).pipeline).not.toHaveProperty(key)
  })

  it('en không còn giá trị nào là chuỗi tiếng Việt của bản cũ', () => {
    const enValues = JSON.stringify((en as any).pipeline)
    for (const stale of ['Chỉ xoá step này', 'Xoá cả các step sau', 'Phạm vi reset', 'Từ chối']) {
      expect(enValues).not.toContain(stale)
    }
  })
})
