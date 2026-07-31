import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  i18n,
  setI18nLocale,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from '@/core/i18n'
import { useLocale } from '@/core/composables/useLocale'
import { useAppSettings, STORAGE_KEY } from '@/core/composables/useAppSettings'
import { resolveLocale } from '../../../../src/core/contracts/schemas/appSettings'

function reset() {
  localStorage.clear()
  useAppSettings().load()
  setI18nLocale('vi')
}

beforeEach(reset)
afterEach(reset)

describe('i18n foundation', () => {
  it('default locale is vi', () => {
    expect(DEFAULT_LOCALE).toBe('vi')
    expect(SUPPORTED_LOCALES).toEqual(['vi', 'en'])
    expect(i18n.global.locale.value).toBe('vi')
  })

  it('resolveLocale: missing/invalid → vi, explicit en → en', () => {
    expect(resolveLocale(null)).toBe('vi')
    expect(resolveLocale({})).toBe('vi')
    expect(resolveLocale({ locale: 'en' })).toBe('en')
    expect(resolveLocale({ locale: 'xx' as unknown as 'en' })).toBe('vi')
  })

  it('t() resolves a shared key and switches with the active locale', () => {
    const t = i18n.global.t
    expect(t('common.modes.logs')).toBe('Nhật ký')
    setI18nLocale('en')
    expect(t('common.modes.logs')).toBe('Logs')
  })

  it('named interpolation works for status.updated', () => {
    expect(i18n.global.t('common.status.updated', { time: '10:00' })).toBe('cập nhật 10:00')
  })

  it('useLocale.setLocale persists the preference and flips the live locale', () => {
    const { locale, setLocale } = useLocale()
    expect(locale.value).toBe('vi')
    setLocale('en')
    expect(locale.value).toBe('en')
    expect(i18n.global.locale.value).toBe('en')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).locale).toBe('en')
  })
})
