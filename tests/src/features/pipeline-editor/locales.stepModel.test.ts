import { describe, expect, it } from 'vitest'
import { createTestI18n } from '../../helpers/i18n'
import { localeMessages } from '../../helpers/localeYaml'

const vi = localeMessages('vi', 'pipelineEditor')
const en = localeMessages('en', 'pipelineEditor')

// Tbfb52394 · nhóm G của test-spec (TC-G14 / TC-G15) — 4 khoá i18n mới của
// control "Model" phải có bản dịch RIÊNG ở cả `vi` lẫn `en`.
//
// Thiếu khoá ở `en` thì vue-i18n fallback im lặng về `vi`: dialog ra nửa Việt
// nửa Anh mà không lỗi nào phát ra, nên không có cách nào khác để bắt ngoài việc
// so trực tiếp hai bảng khoá.

const MODEL_KEYS = [
  'pipelineEditor.stepConfig.model',
  'pipelineEditor.stepConfig.modelDefault',
  'pipelineEditor.stepConfig.modelHint',
  'pipelineEditor.stepConfig.modelUnknown',
]

describe.each(['vi', 'en'] as const)('TC-G14: khoá control Model — locale %s', (locale) => {
  const t = (key: string, args?: Record<string, unknown>) =>
    (createTestI18n(locale).global as any).t(key, args ?? {})

  it.each(MODEL_KEYS)('%s có bản dịch riêng của locale', (key) => {
    const value = t(key)
    // vue-i18n trả lại chính khoá khi thiếu bản dịch — đó là lỗi cần bắt.
    expect(value).not.toBe(key)
    expect(String(value).trim().length).toBeGreaterThan(0)
  })

  it('bản dịch của hai locale khác nhau — fallback im lặng không được tính là có dịch', () => {
    const other = locale === 'vi' ? 'en' : 'vi'
    const tOther = (key: string) => (createTestI18n(other).global as any).t(key)
    // `model` là danh từ riêng, giống nhau hai bên là đúng; ba khoá còn lại là câu chữ.
    for (const key of MODEL_KEYS.filter((k) => !k.endsWith('.model'))) {
      expect(t(key)).not.toBe(tOther(key))
    }
  })

  it('modelUnknown nội suy được {id} — nhãn pin hỏng phải chỉ ra id nào', () => {
    const rendered = String(t('pipelineEditor.stepConfig.modelUnknown', { id: 'da-xoa' }))
    expect(rendered).toContain('da-xoa')
    expect(rendered).not.toContain('{id}')
  })
})

describe('TC-G15: parity khoá giữa vi và en', () => {
  function keysOf(node: unknown, prefix = ''): string[] {
    if (node === null || typeof node !== 'object') return [prefix]
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      keysOf(v, prefix ? `${prefix}.${k}` : k),
    )
  }

  it('khối `stepConfig` bằng nhau hai bên — không khoá thừa, không khoá thiếu', () => {
    const viKeys = keysOf((vi as any).stepConfig).sort()
    const enKeys = keysOf((en as any).stepConfig).sort()
    expect(enKeys).toEqual(viKeys)
    // Bốn khoá mới phải thật sự nằm trong khối đó, không lạc sang namespace khác.
    for (const key of MODEL_KEYS) {
      expect(viKeys).toContain(key.replace('pipelineEditor.stepConfig.', ''))
    }
  })

  it('toàn bộ namespace pipelineEditor bằng nhau hai bên', () => {
    expect(keysOf(en).sort()).toEqual(keysOf(vi).sort())
  })
})
