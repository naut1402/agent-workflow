import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mcpVi from '@/features/mcp/locales/vi'
import mcpEn from '@/features/mcp/locales/en'

/**
 * TC-G01 · TC-G02 (Tdad47b2b) — tập khoá i18n của feature `mcp`.
 *
 * Bỏ ô nhập Id mà để lại khoá i18n của nó là để lại khoá chết: nó không đỏ ở
 * đâu cả, và lần sau có người dịch lại đúng năm chuỗi không còn ai đọc.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const featureDir = path.join(root, 'src/features/mcp')

/** Mọi khoá lá, dạng `a.b.c`. */
function flatKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix]
  return Object.entries(obj).flatMap(([k, v]) => flatKeys(v, prefix ? `${prefix}.${k}` : k))
}

/** Toàn bộ source của feature (`.vue` + `.ts` ngoài `locales/`) gộp thành một chuỗi. */
function featureSource(): string {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'locales') continue
        walk(full)
        continue
      }
      if (/\.(vue|ts)$/.test(entry.name)) out.push(readFileSync(full, 'utf8'))
    }
  }
  walk(featureDir)
  return out.join('\n')
}

/** Năm khoá của ô nhập Id cũ — task Tdad47b2b bỏ hẳn trường này. */
const DEAD_KEYS = [
  'dialog.idField',
  'dialog.idPlaceholder',
  'dialog.idNormalised',
  'errors.idRequired',
  'errors.idExists',
] as const

describe('i18n feature mcp — khoá chết và cân bằng hai locale', () => {
  // TC-G01
  it.each([
    ['vi', mcpVi],
    ['en', mcpEn],
  ] as const)('TC-G01 (%s): 🚫 không còn 5 khoá của ô nhập Id cũ', (_locale, dict) => {
    const keys = new Set(flatKeys(dict))
    for (const dead of DEAD_KEYS) {
      expect(keys.has(dead)).toBe(false)
    }
  })

  // TC-G01 — vế thứ hai: 🚫 không chỗ nào trong UI còn tham chiếu tới chúng.
  it('TC-G01: source của feature 🚫 không còn tham chiếu `mcp.<khoá chết>`', () => {
    const source = featureSource()
    for (const dead of DEAD_KEYS) {
      const leaf = dead.split('.').pop()!
      expect(source).not.toContain(`mcp.${dead}`)
      // `t('mcp.dialog.idField')` được viết đầy đủ ở feature này, nhưng chốt cả
      // tên lá để bắt cả kiểu gọi tương đối nếu ai đó đổi cách dựng khoá.
      expect(source).not.toContain(`${leaf}'`)
    }
  })

  // TC-G02
  it('TC-G02: tập khoá `vi` và `en` bằng nhau — 🚫 không khoá thừa, 🚫 không khoá thiếu', () => {
    const vi = flatKeys(mcpVi).sort()
    const en = flatKeys(mcpEn).sort()

    expect(en).toEqual(vi)
  })

  /** Khoá mới của task phải có mặt ở CẢ hai locale (bảo hiểm cho TC-G02 khi cả hai cùng thiếu). */
  it('TC-G01/G02: khoá thay thế đã có ở cả hai locale', () => {
    for (const key of [
      'dialog.idDerived',
      'dialog.idDerivedHint',
      'dialog.idFrozenHint',
      'dialog.timeoutHint',
      'panel.copyLabelSuffix',
      'errors.labelRequired',
    ]) {
      expect(flatKeys(mcpVi)).toContain(key)
      expect(flatKeys(mcpEn)).toContain(key)
    }
  })
})
