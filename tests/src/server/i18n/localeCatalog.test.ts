import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  REPO_LOCALES,
  listLocales,
  localeEtag,
  readLocaleBundle,
} from '../../../../src/features/i18n/business/index.js'
import { dumpYaml } from '../../../../src/shared/lib/yamlLib'

/**
 * Nhóm A của `test-spec.md` — tầng đọc đĩa của i18n.
 *
 * Hai tầng dữ liệu: repo (`src/shared/locales/`) và overlay (`<dataRoot>/locales/`).
 * `readLocaleBundle` nhận `baseDir` tuỳ chọn (Q1 §7 đã chốt là CÓ), nên ca "file repo
 * hỏng" (G-C7) được phủ TRỰC TIẾP ở tầng repo chứ không chỉ gián tiếp qua overlay.
 */

let tmp: string

/** Ghi một namespace locale dạng YAML (định dạng nguồn sự thật). */
function writeNs(file: string, tree: unknown): void {
  fs.writeFileSync(file, dumpYaml(tree))
}

/** Chạy `fn` với `console.warn` bị chặn; trả về các lượt warn đã gom. */
async function captureWarn<T>(fn: () => Promise<T>): Promise<{ result: T; warns: unknown[][] }> {
  const warns: unknown[][] = []
  const warn = console.warn
  console.warn = (...a: unknown[]) => void warns.push(a)
  try {
    return { result: await fn(), warns }
  } finally {
    console.warn = warn
  }
}

/** FX-ROOT — data root tạm theo §4.1 của spec. */
function writeFxRoot(root: string): void {
  const l = path.join(root, 'locales')
  fs.mkdirSync(path.join(l, 'vi'), { recursive: true })
  fs.mkdirSync(path.join(l, 'ja'), { recursive: true })
  writeNs(path.join(l, 'vi', 'common.yaml'), { language: { names: { vi: 'OVERLAY-VI' } } })
  writeNs(path.join(l, 'vi', 'custom.yaml'), { hello: 'xin chào riêng' })
  writeNs(path.join(l, 'ja', 'common.yaml'), { language: { names: { ja: '日本語' } } })
}

/** FX-BROKEN — một file YAML hỏng cú pháp chắc chắn (§4.2): flow sequence không đóng. */
const BROKEN_YAML = 'a: [chua dong ngoac\nb: c\n'
function writeFxBroken(root: string, locale = 'vi'): void {
  fs.writeFileSync(path.join(root, 'locales', locale, 'broken.yaml'), BROKEN_YAML)
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-catalog-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('listLocales — hợp của hai tầng, thứ tự ghim', () => {
  test('TC-A01: liệt kê locale từ repo, `vi` đứng trước `en`', async () => {
    expect(await listLocales(null)).toEqual(['vi', 'en'])
  })

  test('TC-A02: overlay thêm locale mới — vi/en giữ đầu, phần còn lại alphabet', async () => {
    writeFxRoot(tmp)
    expect(await listLocales(tmp)).toEqual(['vi', 'en', 'ja'])
  })

  test('TC-A03: overlay dir không tồn tại ⇒ như repo, không ném, không log lỗi', async () => {
    const warns: unknown[] = []
    const errors: unknown[] = []
    const warn = console.warn
    const error = console.error
    console.warn = (...a: unknown[]) => void warns.push(a)
    console.error = (...a: unknown[]) => void errors.push(a)
    try {
      // tmp tồn tại nhưng KHÔNG có thư mục `locales/` bên trong — ca phổ biến nhất.
      expect(await listLocales(tmp)).toEqual(['vi', 'en'])
    } finally {
      console.warn = warn
      console.error = error
    }
    expect(warns).toEqual([])
    expect(errors).toEqual([])
  })

  test('TC-A04: không có data root, gọi lặp ⇒ ổn định, không ném', async () => {
    const first = await listLocales(null)
    const second = await listLocales(null)
    expect(second).toEqual(first)
  })

  test('TC-A02b: locale overlay có mã không hợp lệ bị loại khỏi danh sách', async () => {
    writeFxRoot(tmp)
    fs.mkdirSync(path.join(tmp, 'locales', 'KHONG_HOP_LE'), { recursive: true })
    expect(await listLocales(tmp)).toEqual(['vi', 'en', 'ja'])
  })

  test('TC-A02c: thư mục locale không có file `.yaml` nào ⇒ không vào manifest, bundle null', async () => {
    writeFxRoot(tmp)
    fs.mkdirSync(path.join(tmp, 'locales', 'ko'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'locales', 'fr'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'locales', 'fr', 'common.json'), '{"a":"b"}')

    expect(await listLocales(tmp)).toEqual(['vi', 'en', 'ja'])
    expect(await readLocaleBundle('ko', tmp)).toBeNull()
    expect(await readLocaleBundle('fr', tmp)).toBeNull()
  })

  test('TC-A15: env đã tước ⇒ kết quả không đổi (chạy cùng lượt, không phụ thuộc HOME)', async () => {
    const savedHome = process.env.HOME
    const savedDash = process.env.DEV_TEAM_DASHBOARD_HOME
    process.env.HOME = ''
    process.env.DEV_TEAM_DASHBOARD_HOME = '/nonexistent'
    try {
      expect(await listLocales(null)).toEqual(['vi', 'en'])
      const bundle = await readLocaleBundle('vi', null)
      expect(bundle).not.toBeNull()
      expect(bundle!.common).toBeDefined()
    } finally {
      if (savedHome === undefined) delete process.env.HOME
      else process.env.HOME = savedHome
      if (savedDash === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
      else process.env.DEV_TEAM_DASHBOARD_HOME = savedDash
    }
  })
})

describe('readLocaleBundle — merge repo + overlay', () => {
  test('TC-A05: bundle đầy đủ của repo', async () => {
    const bundle = await readLocaleBundle('vi', null)
    expect(bundle).not.toBeNull()
    expect(bundle!.common).toBeDefined()
    const namespaces = Object.keys(bundle!)
    expect(namespaces.length).toBeGreaterThanOrEqual(15)
    for (const ns of namespaces) {
      expect(typeof bundle![ns]).toBe('object')
      expect(Object.keys(bundle![ns]).length).toBeGreaterThan(0)
    }
  })

  test('TC-A06: overlay DEEP-MERGE, không thay cả namespace', async () => {
    writeFxRoot(tmp)
    const repoCommon = (await readLocaleBundle('vi', null))!.common as Record<string, unknown>
    const merged = (await readLocaleBundle('vi', tmp))!.common as Record<string, unknown>

    const language = merged.language as { names: Record<string, string> }
    expect(language.names.vi).toBe('OVERLAY-VI')
    // `en` nằm cùng nhánh `language.names` mà overlay KHÔNG nhắc tới → phải còn.
    expect(language.names.en).toBe(
      ((repoCommon.language as { names: Record<string, string> }).names).en,
    )
    // Và mọi khoá cấp một khác của `common` cũng còn nguyên.
    for (const key of Object.keys(repoCommon)) {
      expect(Object.keys(merged)).toContain(key)
    }
  })

  test('TC-A07: namespace chỉ có ở overlay được thêm vào bundle (G-C9)', async () => {
    writeFxRoot(tmp)
    const bundle = await readLocaleBundle('vi', tmp)
    expect(bundle!.custom).toEqual({ hello: 'xin chào riêng' })
  })

  test('TC-A08: một file YAML hỏng trong overlay ⇒ bỏ đúng file đó, không ném, warn rõ (G-C7)', async () => {
    writeFxRoot(tmp)
    writeFxBroken(tmp)
    const { result: bundle, warns } = await captureWarn(() => readLocaleBundle('vi', tmp))
    expect(bundle).not.toBeNull()
    // Đúng một cảnh báo, nêu đúng file hỏng.
    expect(warns.length).toBe(1)
    expect(String(warns[0][0])).toContain('bỏ qua file YAML hỏng')
    expect(String(warns[0][0])).toContain('broken.yaml')
    expect(Object.keys(bundle!)).not.toContain('broken')
    // Mọi namespace khác nguyên vẹn.
    expect(bundle!.custom).toEqual({ hello: 'xin chào riêng' })
    const repoNamespaces = Object.keys((await readLocaleBundle('vi', null))!)
    for (const ns of repoNamespaces) {
      expect(Object.keys(bundle!)).toContain(ns)
    }
  })

  test('TC-A08b (Q1): file YAML hỏng ở tầng REPO cũng chỉ mất đúng file đó (G-C7 trực tiếp)', async () => {
    // `baseDir` là tham số thứ 3 → dựng được một "repo" giả để kiểm đúng tầng repo,
    // thay vì chỉ suy ra từ đường overlay.
    const base = path.join(tmp, 'repo-locales')
    fs.mkdirSync(path.join(base, 'vi'), { recursive: true })
    writeNs(path.join(base, 'vi', 'common.yaml'), { ok: 'OK' })
    fs.writeFileSync(path.join(base, 'vi', 'hong.yaml'), BROKEN_YAML)

    const { result: bundle, warns } = await captureWarn(() => readLocaleBundle('vi', null, base))
    expect(bundle).not.toBeNull()
    expect(bundle!.common).toEqual({ ok: 'OK' })
    expect(Object.keys(bundle!)).not.toContain('hong')
    expect(warns.map((w) => String(w[0]))).toEqual([
      expect.stringContaining('bỏ qua file YAML hỏng'),
    ])
  })

  test('TC-A08d: chỉ đọc `*.yaml` — file `.json` / `.yml` / `.ts` cũ nằm cạnh bị bỏ qua, không warn', async () => {
    const base = path.join(tmp, 'repo-locales')
    fs.mkdirSync(path.join(base, 'vi'), { recursive: true })
    writeNs(path.join(base, 'vi', 'common.yaml'), { ok: 'OK' })
    fs.writeFileSync(path.join(base, 'vi', 'cu.json'), JSON.stringify({ x: 'json cũ' }))
    fs.writeFileSync(path.join(base, 'vi', 'khac.yml'), 'x: yml\n')
    fs.writeFileSync(path.join(base, 'vi', 'module.ts'), 'export default { x: 1 }\n')

    const { result: bundle, warns } = await captureWarn(() => readLocaleBundle('vi', null, base))
    expect(Object.keys(bundle!)).toEqual(['common'])
    expect(warns).toEqual([])
  })

  test('TC-A08e: YAML lồng nhiều cấp + khoá có dấu chấm đã lồng thành cây được đọc nguyên vẹn', async () => {
    const base = path.join(tmp, 'repo-locales')
    fs.mkdirSync(path.join(base, 'vi'), { recursive: true })
    fs.writeFileSync(
      path.join(base, 'vi', 'automations.yaml'),
      'eventNames:\n  job:\n    started: Job bắt đầu\n    failed: "Job lỗi: {reason}"\n',
    )
    const bundle = await readLocaleBundle('vi', null, base)
    expect(bundle!.automations).toEqual({
      eventNames: { job: { started: 'Job bắt đầu', failed: 'Job lỗi: {reason}' } },
    })
  })

  test('TC-A08c: namespace không phải object (mảng/scalar) bị bỏ như file hỏng', async () => {
    const base = path.join(tmp, 'repo-locales')
    fs.mkdirSync(path.join(base, 'vi'), { recursive: true })
    writeNs(path.join(base, 'vi', 'common.yaml'), { ok: 'OK' })
    fs.writeFileSync(path.join(base, 'vi', 'mang.yaml'), '- a\n- b\n')
    fs.writeFileSync(path.join(base, 'vi', 'so.yaml'), '42\n')
    // File rỗng: YAML hợp lệ nhưng không ra object.
    fs.writeFileSync(path.join(base, 'vi', 'rong.yaml'), '')

    const { result: bundle } = await captureWarn(() => readLocaleBundle('vi', null, base))
    expect(Object.keys(bundle!).sort()).toEqual(['common'])
  })

  test('TC-A09: locale chỉ tồn tại ở overlay vẫn đọc được', async () => {
    writeFxRoot(tmp)
    const bundle = await readLocaleBundle('ja', tmp)
    expect(bundle).not.toBeNull()
    expect((bundle!.common as { language: { names: Record<string, string> } }).language.names.ja).toBe(
      '日本語',
    )
  })

  test('TC-A10: locale không tồn tại ở cả hai tầng ⇒ null', async () => {
    writeFxRoot(tmp)
    expect(await readLocaleBundle('de', tmp)).toBeNull()
    expect(await readLocaleBundle('de', null)).toBeNull()
  })

  test('TC-A11: mã locale không hợp lệ ⇒ null, không ném, không đọc ngoài base dir (G-C4)', async () => {
    writeFxRoot(tmp)
    const bad = ['../../etc', 'vi/..', 'VI', '', 'v', 'vi-vn', '..', './vi', 'vi\0', 'vi%2F..']
    for (const code of bad) {
      expect(await readLocaleBundle(code, tmp)).toBeNull()
      expect(await readLocaleBundle(code, null)).toBeNull()
    }
  })

  test('TC-A03b: overlay dir không tồn tại ⇒ bundle repo nguyên vẹn (G-C8)', async () => {
    const withOverlay = await readLocaleBundle('vi', tmp)
    const repoOnly = await readLocaleBundle('vi', null)
    expect(withOverlay).toEqual(repoOnly)
  })
})

describe('localeEtag — hash nội dung, ổn định', () => {
  test('TC-A12: cùng nội dung khác thứ tự chèn khoá ⇒ cùng ETag (G-C15)', () => {
    const a = { common: { b: '2', a: '1' }, monitor: { z: 'z' } }
    const b = { monitor: { z: 'z' }, common: { a: '1', b: '2' } }
    expect(localeEtag(a)).toBe(localeEtag(b))
  })

  test('TC-A13: đổi đúng một giá trị lá ⇒ ETag khác', () => {
    const a = { common: { a: '1' } }
    const b = { common: { a: '2' } }
    expect(localeEtag(a)).not.toBe(localeEtag(b))
  })

  test('TC-A14: ETag hợp lệ cú pháp HTTP', async () => {
    const bundle = await readLocaleBundle('vi', null)
    expect(localeEtag(bundle)).toMatch(/^"[\x21\x23-\x7E]+"$/)
  })

  test('TC-A13b: ETag của hai locale khác nhau thì khác nhau', async () => {
    const vi = await readLocaleBundle('vi', null)
    const en = await readLocaleBundle('en', null)
    expect(localeEtag(vi)).not.toBe(localeEtag(en))
  })
})

describe('REPO_LOCALES — hằng suy từ import.meta.url', () => {
  test('trỏ đúng `src/shared/locales` và thư mục đó có thật', () => {
    expect(REPO_LOCALES.endsWith(path.join('src', 'shared', 'locales'))).toBe(true)
    expect(fs.existsSync(REPO_LOCALES)).toBe(true)
  })
})
