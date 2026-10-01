import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Nhóm D của `test-spec.md` — lưới DUY NHẤT chặn rơi khoá dịch.
 *
 * `fallbackLocale: 'vi'` che khoá thiếu ở `en`: một khoá rơi vẫn hiện chữ tiếng Việt
 * và KHÔNG đỏ ở bất kỳ đâu khác. ~1.4k khoá × 2 locale được migrate bằng codemod, nên
 * đây là chỗ duy nhất chứng minh đầu ra của codemod còn đủ.
 *
 * Đọc bằng `node:fs` chứ KHÔNG qua `import.meta.glob`: phải kiểm đúng thứ nằm trên
 * đĩa, không kiểm thứ bundler nhìn thấy (đường glob đã có nhóm E canh riêng).
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const LOCALES_DIR = path.join(REPO_ROOT, 'src/shared/locales')

type Tree = Record<string, unknown>

function localeDirs(): string[] {
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

function namespacesOf(locale: string): string[] {
  return readdirSync(path.join(LOCALES_DIR, locale))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort()
}

/** Toàn bộ bundle của một locale: `{ namespace: tree }`. */
function bundleOf(locale: string): Record<string, Tree> {
  const out: Record<string, Tree> = {}
  for (const ns of namespacesOf(locale)) {
    out[ns] = JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, `${ns}.json`), 'utf8'))
  }
  return out
}

/** `{a:{b:'x'}}` → `['a.b']`. Chỉ lá; nhánh rỗng cũng tính là lá để TC-D05 bắt được. */
function flatKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix]
  }
  const entries = Object.entries(value as Tree)
  if (entries.length === 0) return [prefix]
  return entries.flatMap(([k, v]) => flatKeys(v, prefix ? `${prefix}.${k}` : k))
}

/** Mọi cặp `[khoá phẳng, giá trị lá]` của một bundle. */
function flatEntries(value: unknown, prefix = ''): [string, unknown][] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [[prefix, value]]
  }
  const entries = Object.entries(value as Tree)
  if (entries.length === 0) return [[prefix, value]]
  return entries.flatMap(([k, v]) => flatEntries(v, prefix ? `${prefix}.${k}` : k))
}

/** Khoá phẳng toàn cục: `namespace.a.b.c`. */
function allKeys(locale: string): string[] {
  const bundle = bundleOf(locale)
  return Object.entries(bundle)
    .flatMap(([ns, tree]) => flatKeys(tree, ns))
    .sort()
}

/**
 * So hai cây và trả khoá lệch. Hàm này là thứ TC-D01 dựa vào, nên TC-D03 kiểm chính nó
 * — TC-D01 xanh phải vì dữ liệu đúng, không vì hàm diff hỏng.
 */
export function diffKeys(
  base: unknown,
  other: unknown,
  prefix = '',
): { missing: string[]; extra: string[] } {
  const a = new Set(flatKeys(base, prefix))
  const b = new Set(flatKeys(other, prefix))
  return {
    missing: [...b].filter((k) => !a.has(k)).sort(),
    extra: [...a].filter((k) => !b.has(k)).sort(),
  }
}

/** Placeholder kiểu vue-i18n: `{count}`, `{name}`. Bỏ `{{…}}` và `{0}` index. */
function placeholders(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return [...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort()
}

/** Thông điệp đỏ phải LIỆT KÊ khoá lệch theo từng namespace, không chỉ "khác nhau". */
function reportByNamespace(
  from: string,
  to: string,
  diff: { missing: string[]; extra: string[] },
): string {
  const group = (keys: string[]) => {
    const byNs = new Map<string, string[]>()
    for (const key of keys) {
      const ns = key.split('.')[0]
      byNs.set(ns, [...(byNs.get(ns) ?? []), key])
    }
    return [...byNs.entries()]
      .map(([ns, list]) => `    ${ns}: ${list.join(', ')}`)
      .join('\n')
  }
  return [
    `Lệch khoá giữa '${from}' và '${to}':`,
    diff.extra.length ? `  CHỈ CÓ ở '${from}' (${diff.extra.length}):\n${group(diff.extra)}` : '',
    diff.missing.length
      ? `  THIẾU ở '${from}', có ở '${to}' (${diff.missing.length}):\n${group(diff.missing)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const LOCALES = localeDirs()
/** Mốc sàn của spec — codemod sinh thiếu file thì đỏ ở TC-D04, không "xanh vì rỗng". */
const MIN_KEYS = 1368

describe('TC-D03: chính hàm diff phải đúng', () => {
  it('trả đúng missing/extra trên hai object giả có lệch', () => {
    expect(diffKeys({ a: { b: 1 } }, { a: { c: 1 } })).toEqual({
      missing: ['a.c'],
      extra: ['a.b'],
    })
  })

  it('hai cây bằng nhau ⇒ không lệch', () => {
    expect(diffKeys({ a: { b: 1, c: 2 } }, { a: { c: 2, b: 1 } })).toEqual({
      missing: [],
      extra: [],
    })
  })

  it('lệch nhiều tầng được nêu theo đường đầy đủ', () => {
    expect(diffKeys({ x: { y: { z: 1 } } }, { x: { y: { w: 1 } } })).toEqual({
      missing: ['x.y.w'],
      extra: ['x.y.z'],
    })
  })

  it('tiền tố namespace đi vào khoá', () => {
    expect(diffKeys({ a: 1 }, { b: 1 }, 'common')).toEqual({
      missing: ['common.b'],
      extra: ['common.a'],
    })
  })
})

describe('TC-D04: chống "xanh vì tập rỗng"', () => {
  it(`có ≥ 2 locale và mỗi locale có ≥ ${MIN_KEYS} khoá`, () => {
    expect(LOCALES.length).toBeGreaterThanOrEqual(2)
    for (const locale of LOCALES) {
      const count = allKeys(locale).length
      expect(`${locale}:${count >= MIN_KEYS}`).toBe(`${locale}:true`)
    }
  })

  it('mỗi locale có ≥ 15 namespace, không namespace nào rỗng', () => {
    for (const locale of LOCALES) {
      const bundle = bundleOf(locale)
      expect(Object.keys(bundle).length).toBeGreaterThanOrEqual(15)
      for (const [ns, tree] of Object.entries(bundle)) {
        expect(`${locale}/${ns}:${Object.keys(tree).length > 0}`).toBe(`${locale}/${ns}:true`)
      }
    }
  })
})

describe('TC-D02: parity NAMESPACE', () => {
  it('mọi locale có đúng cùng tập file `.json`', () => {
    const base = LOCALES[0]
    const expected = namespacesOf(base)
    for (const locale of LOCALES.slice(1)) {
      expect(`${locale}: ${namespacesOf(locale).join(',')}`).toBe(`${locale}: ${expected.join(',')}`)
    }
  })
})

describe('TC-D01: parity KHOÁ giữa mọi cặp locale (G-C5, G-C6)', () => {
  it('mọi locale có đúng cùng tập khoá — khi đỏ thì liệt kê theo namespace', () => {
    const bundles = Object.fromEntries(LOCALES.map((l) => [l, bundleOf(l)]))
    const base = LOCALES[0]
    const problems: string[] = []

    for (const locale of LOCALES.slice(1)) {
      const namespaces = new Set([
        ...Object.keys(bundles[base]),
        ...Object.keys(bundles[locale]),
      ])
      const missing: string[] = []
      const extra: string[] = []
      for (const ns of [...namespaces].sort()) {
        const d = diffKeys(bundles[locale][ns] ?? {}, bundles[base][ns] ?? {}, ns)
        missing.push(...d.missing)
        extra.push(...d.extra)
      }
      if (missing.length || extra.length) {
        problems.push(reportByNamespace(locale, base, { missing, extra }))
      }
    }

    expect(problems.join('\n\n')).toBe('')
  })
})

describe('TC-D05 · TC-D08: hình dạng giá trị lá', () => {
  it('TC-D05: mọi lá là chuỗi — không null, không mảng, không object rỗng', () => {
    const bad: string[] = []
    for (const locale of LOCALES) {
      for (const [ns, tree] of Object.entries(bundleOf(locale))) {
        for (const [key, value] of flatEntries(tree, ns)) {
          if (typeof value !== 'string') {
            bad.push(`${locale}/${key} = ${JSON.stringify(value)} (${typeof value})`)
          }
        }
      }
    }
    expect(bad.join('\n')).toBe('')
  })

  it('TC-D08: không giá trị nào rỗng hoặc chỉ whitespace', () => {
    const empty: string[] = []
    for (const locale of LOCALES) {
      for (const [ns, tree] of Object.entries(bundleOf(locale))) {
        for (const [key, value] of flatEntries(tree, ns)) {
          if (typeof value === 'string' && value.trim() === '') empty.push(`${locale}/${key}`)
        }
      }
    }
    expect(empty.join('\n')).toBe('')
  })
})

describe('TC-D06: parity INTERPOLATION', () => {
  it('cùng một khoá có cùng tập placeholder ở mọi locale', () => {
    const base = LOCALES[0]
    const baseBundle = bundleOf(base)
    const baseMap = new Map(
      Object.entries(baseBundle).flatMap(([ns, tree]) => flatEntries(tree, ns)),
    )
    const problems: string[] = []

    for (const locale of LOCALES.slice(1)) {
      for (const [ns, tree] of Object.entries(bundleOf(locale))) {
        for (const [key, value] of flatEntries(tree, ns)) {
          if (!baseMap.has(key)) continue
          const a = placeholders(baseMap.get(key))
          const b = placeholders(value)
          if (a.join(',') !== b.join(',')) {
            problems.push(
              `${key}: ${base}=[${a.join(',')}] ≠ ${locale}=[${b.join(',')}]`,
            )
          }
        }
      }
    }

    expect(problems.join('\n')).toBe('')
  })

  it('chính hàm trích placeholder phải đúng (bảo hiểm cho ca trên)', () => {
    expect(placeholders('Có {count} việc của {name}')).toEqual(['count', 'name'])
    expect(placeholders('không có gì')).toEqual([])
    expect(placeholders(42)).toEqual([])
  })
})

describe('TC-D07: overlay KHÔNG tham gia parity (G-C9)', () => {
  const overlayDir = path.join(REPO_ROOT, '.dev-team-agent/locales/vi')
  const overlayFile = path.join(overlayDir, 'chi-co-vi.json')
  let created = false

  afterEach(() => {
    if (!created) return
    rmSync(overlayFile, { force: true })
    // Chỉ dọn thư mục mình tạo, không đụng `.dev-team-agent/` của máy chạy test.
    try {
      rmSync(overlayDir, { recursive: false })
      rmSync(path.dirname(overlayDir), { recursive: false })
    } catch {
      /* thư mục còn nội dung khác — để nguyên */
    }
    created = false
  })

  it('thêm namespace chỉ có ở overlay không làm đổi kết quả parity', () => {
    const before = Object.fromEntries(LOCALES.map((l) => [l, allKeys(l)]))

    expect(existsSync(overlayFile)).toBe(false)
    mkdirSync(overlayDir, { recursive: true })
    writeFileSync(overlayFile, JSON.stringify({ chiCoViThoi: 'chỉ có ở overlay' }))
    created = true

    for (const locale of LOCALES) {
      expect(allKeys(locale)).toEqual(before[locale])
    }
  })
})
