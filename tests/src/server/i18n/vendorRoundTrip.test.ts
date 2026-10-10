import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dumpYaml, loadYaml } from '../../../../src/shared/lib/yamlLib'

/**
 * Nhóm K của `test-spec.md` — tiêu chí 3 của `request.md`: "chỉ cần gửi file text
 * cho biên dịch".
 *
 * Hai script này ghi thẳng vào NGUỒN SỰ THẬT (`src/shared/locales/`), nên file này
 * chụp toàn bộ cây trước khi chạy và khôi phục sau MỖI ca. Một ca đỏ không được phép
 * để lại cây locale đã bị sửa — đó đúng là kiểu hỏng mà TC-K05 đang canh.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const LOCALES_DIR = path.join(REPO_ROOT, 'src/shared/locales')
const OUT_DIR = path.join(REPO_ROOT, 'out/i18n')

type Snapshot = Map<string, string>

function snapshotLocales(): Snapshot {
  const out: Snapshot = new Map()
  for (const locale of fs.readdirSync(LOCALES_DIR)) {
    const dir = path.join(LOCALES_DIR, locale)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.yaml')) continue
      out.set(`${locale}/${file}`, fs.readFileSync(path.join(dir, file), 'utf8'))
    }
  }
  return out
}

function restoreLocales(snap: Snapshot): void {
  // Xoá file lạ (ca "namespace lạ" lỡ tạo file mới) rồi ghi lại nội dung cũ.
  for (const locale of fs.readdirSync(LOCALES_DIR)) {
    const dir = path.join(LOCALES_DIR, locale)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.yaml') && !snap.has(`${locale}/${file}`)) {
        fs.rmSync(path.join(dir, file))
      }
    }
  }
  for (const [rel, content] of snap) {
    const target = path.join(LOCALES_DIR, rel)
    if (fs.readFileSync(target, 'utf8') !== content) fs.writeFileSync(target, content)
  }
}

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(['bun', ...args], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' })
  return {
    code: proc.exitCode ?? 1,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  }
}

const exportAll = (extra: string[] = []) => run(['scripts/i18n-export.ts', ...extra])
const importFile = (locale: string, file: string) =>
  run(['scripts/i18n-import.ts', `--locale=${locale}`, file])

/** Tổng khoá lá của một locale, đọc thẳng từ đĩa (không qua script đang kiểm). */
function diskKeyCount(locale: string): number {
  let n = 0
  const walk = (v: unknown): void => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const child of Object.values(v as Record<string, unknown>)) walk(child)
    } else {
      n++
    }
  }
  const dir = path.join(LOCALES_DIR, locale)
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    walk(loadYaml(fs.readFileSync(path.join(dir, file), 'utf8')))
  }
  return n
}

let pristine: Snapshot
let tmp: string

beforeAll(() => {
  pristine = snapshotLocales()
})

afterEach(() => {
  restoreLocales(pristine)
})

afterAll(() => {
  restoreLocales(pristine)
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
})

/** File vendor trả về — YAML phẳng, khoá `namespace.a.b.c`. */
function writeFlat(file: string, flat: Record<string, string>): void {
  fs.writeFileSync(file, dumpYaml(flat, { lineWidth: -1 }))
}

function readYamlFile(file: string): Record<string, any> {
  return loadYaml(fs.readFileSync(file, 'utf8')) as Record<string, any>
}

describe('i18n:export — một file phẳng mỗi locale', () => {
  test('TC-K01: sinh `out/i18n/<locale>.yaml`, khoá dạng `namespace.a.b.c`, đủ số khoá', () => {
    const r = exportAll()
    expect(r.code).toBe(0)

    for (const locale of ['vi', 'en']) {
      const target = path.join(OUT_DIR, `${locale}.yaml`)
      expect(fs.existsSync(target)).toBe(true)
      const flat = readYamlFile(target) as Record<string, string>
      expect(Object.keys(flat).length).toBe(diskKeyCount(locale))
      // Khoá phải mang tiền tố namespace (tên file), tức có ít nhất một dấu chấm.
      const namespaces = new Set(
        fs
          .readdirSync(path.join(LOCALES_DIR, locale))
          .filter((f) => f.endsWith('.yaml'))
          .map((f) => f.slice(0, -'.yaml'.length)),
      )
      for (const key of Object.keys(flat)) {
        expect(key).toContain('.')
        expect(namespaces.has(key.split('.')[0])).toBe(true)
      }
    }
  })

  test('TC-K01b: file export là YAML phẳng — mỗi khoá đúng một dòng, không lồng, không gập (`lineWidth: -1`)', () => {
    expect(exportAll().code).toBe(0)
    const raw = fs.readFileSync(path.join(OUT_DIR, 'vi.yaml'), 'utf8')
    const flat = loadYaml(raw) as Record<string, string>
    // Mỗi khoá đúng một dòng không thụt đầu (không có cấp lồng). Dòng thụt đầu chỉ được
    // phép là thân block literal (`|`, `|-`) của giá trị VỐN có xuống dòng — 🚫 kiểu gập
    // `>` (dấu hiệu lineWidth bị bật lại) và 🚫 nhánh con.
    const lines = raw.split('\n').filter((l) => l.length > 0)
    const top = lines.filter((l) => !l.startsWith(' '))
    expect(top.length).toBe(Object.keys(flat).length)
    const literalHead = /: \|[-+]?\d*$/
    let owner = ''
    const bad: string[] = []
    for (const line of lines) {
      if (!line.startsWith(' ')) owner = line
      else if (!literalHead.test(owner)) bad.push(`${owner}  <-  ${line}`)
    }
    expect(bad.join('\n')).toBe('')
    const multiline = Object.values(flat).filter((v) => v.includes('\n')).length
    expect(top.filter((l) => literalHead.test(l)).length).toBe(multiline)
  })

  test('TC-K02: chạy 2 lần ra file GIỐNG HỆT — vendor không nhận "thay đổi ảo"', () => {
    expect(exportAll().code).toBe(0)
    const first = fs.readFileSync(path.join(OUT_DIR, 'vi.yaml'), 'utf8')
    expect(exportAll().code).toBe(0)
    expect(fs.readFileSync(path.join(OUT_DIR, 'vi.yaml'), 'utf8')).toBe(first)
    // Và khoá đã sort — nguồn của tính ổn định đó.
    const keys = Object.keys(loadYaml(first) as Record<string, string>)
    expect(keys).toEqual([...keys].sort())
  })

  test('TC-K03: mọi giá trị export là string', () => {
    expect(exportAll().code).toBe(0)
    for (const locale of ['vi', 'en']) {
      const flat = readYamlFile(path.join(OUT_DIR, `${locale}.yaml`))
      for (const [key, value] of Object.entries(flat)) {
        expect([key, typeof value]).toEqual([key, 'string'])
      }
    }
  })

  test('TC-K10: export locale không tồn tại ⇒ exit khác 0, thông điệp rõ', () => {
    const r = exportAll(['--locale=de'])
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('de')
  })
})

describe('i18n:import — ghi ngược, KHÔNG xoá khoá', () => {
  test('TC-K04: round-trip export → import KHÔNG đổi một byte nào của nguồn sự thật', () => {
    expect(exportAll().code).toBe(0)
    expect(importFile('vi', path.join(OUT_DIR, 'vi.yaml')).code).toBe(0)
    expect(importFile('en', path.join(OUT_DIR, 'en.yaml')).code).toBe(0)

    const after = snapshotLocales()
    expect([...after.keys()].sort()).toEqual([...pristine.keys()].sort())
    for (const [rel, content] of pristine) {
      expect([rel, after.get(rel)]).toEqual([rel, content])
    }
  })

  test('TC-K05: file vendor chỉ 1 khoá ⇒ cập nhật khoá đó, MỌI khoá khác còn nguyên (G-C17)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vendor-'))
    try {
      const file = path.join(tmp, 'vi.yaml')
      writeFlat(file, { 'common.language.names.vi': 'Tiếng Việt (vendor sửa)' })
      expect(importFile('vi', file).code).toBe(0)

      const common = readYamlFile(path.join(LOCALES_DIR, 'vi/common.yaml'))
      expect(common.language.names.vi).toBe('Tiếng Việt (vendor sửa)')

      // Mọi khoá khác của `common` giữ nguyên giá trị cũ…
      const before = loadYaml(pristine.get('vi/common.yaml')!) as Record<string, any>
      expect(common.language.names.en).toBe(before.language.names.en)
      expect(Object.keys(common).sort()).toEqual(Object.keys(before).sort())
      // …và mọi file KHÁC không bị đụng (TC-K07 cùng một lượt chạy).
      const after = snapshotLocales()
      for (const [rel, content] of pristine) {
        if (rel === 'vi/common.yaml') continue
        expect([rel, after.get(rel)]).toEqual([rel, content])
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('TC-K05b: import KHÔNG sort khoá — giữ thứ tự gốc của file nguồn, khoá mới nối cuối', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vendor-'))
    try {
      const before = loadYaml(pristine.get('vi/common.yaml')!) as Record<string, any>
      const topBefore = Object.keys(before)
      const langBefore = Object.keys(before.language)
      // Tiền đề: file nguồn không sort sẵn, nên "giữ thứ tự" khác hẳn "sort lại".
      expect(topBefore).not.toEqual([...topBefore].sort())

      const file = path.join(tmp, 'vi.yaml')
      writeFlat(file, {
        'common.language.names.vi': 'Tiếng Việt (vendor sửa)',
        'common.language.aaaKhoaMoi': 'khoá mới cấp con',
        'common.aaaKhoaMoiGoc': 'khoá mới cấp gốc',
      })
      expect(importFile('vi', file).code).toBe(0)

      const after = readYamlFile(path.join(LOCALES_DIR, 'vi/common.yaml'))
      expect(Object.keys(after)).toEqual([...topBefore, 'aaaKhoaMoiGoc'])
      expect(Object.keys(after.language)).toEqual([...langBefore, 'aaaKhoaMoi'])
      expect(after.language.aaaKhoaMoi).toBe('khoá mới cấp con')
      expect(after.aaaKhoaMoiGoc).toBe('khoá mới cấp gốc')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('TC-K06: namespace lạ bị bỏ qua — cảnh báo, KHÔNG tạo file mới, exit 0', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vendor-'))
    try {
      const file = path.join(tmp, 'vi.yaml')
      // FX-FLAT của §4.3.
      writeFlat(file, {
        'common.language.names.vi': 'Tiếng Việt (vendor sửa)',
        'khongTonTai.a.b': 'namespace lạ',
      })
      const r = importFile('vi', file)
      expect(r.code).toBe(0)
      expect(`${r.stdout}${r.stderr}`).toContain('khongTonTai.a.b')
      expect(fs.existsSync(path.join(LOCALES_DIR, 'vi/khongTonTai.yaml'))).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('TC-K07: vendor đổi 1 khoá của `common` ⇒ CHỈ `common.yaml` đổi', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vendor-'))
    try {
      const file = path.join(tmp, 'en.yaml')
      writeFlat(file, { 'common.language.title': 'Language (changed)' })
      expect(importFile('en', file).code).toBe(0)

      const after = snapshotLocales()
      const changed = [...after.keys()].filter((rel) => after.get(rel) !== pristine.get(rel))
      expect(changed).toEqual(['en/common.yaml'])
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('TC-K08: giữ nguyên interpolation `{count}` — không escape, không đổi tên', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vendor-'))
    try {
      const file = path.join(tmp, 'en.yaml')
      writeFlat(file, { 'common.language.title': 'Language ({count} available)' })
      expect(importFile('en', file).code).toBe(0)
      const raw = fs.readFileSync(path.join(LOCALES_DIR, 'en/common.yaml'), 'utf8')
      expect(raw).toContain('{count}')
      expect((loadYaml(raw) as Record<string, any>).language.title).toBe(
        'Language ({count} available)',
      )
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('TC-K09: file vendor là YAML hỏng cú pháp ⇒ exit khác 0 và KHÔNG ghi gì', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vendor-'))
    try {
      const file = path.join(tmp, 'rac.yaml')
      fs.writeFileSync(file, 'common.language.title: [chua dong ngoac\n  : {{{\n')
      const r = importFile('vi', file)
      expect(r.code).not.toBe(0)

      const after = snapshotLocales()
      for (const [rel, content] of pristine) {
        expect([rel, after.get(rel)]).toEqual([rel, content])
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('TC-K09a: file vendor là scalar (không phải mapping) ⇒ exit khác 0 và KHÔNG ghi gì', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vendor-'))
    try {
      const file = path.join(tmp, 'scalar.yaml')
      fs.writeFileSync(file, 'day khong phai mapping\n')
      expect(importFile('vi', file).code).not.toBe(0)
      const after = snapshotLocales()
      for (const [rel, content] of pristine) {
        expect([rel, after.get(rel)]).toEqual([rel, content])
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('TC-K09b: file vendor là mảng YAML ⇒ exit khác 0 và KHÔNG ghi gì', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vendor-'))
    try {
      const file = path.join(tmp, 'mang.yaml')
      fs.writeFileSync(file, '- a\n- b\n')
      expect(importFile('vi', file).code).not.toBe(0)
      const after = snapshotLocales()
      for (const [rel, content] of pristine) {
        expect([rel, after.get(rel)]).toEqual([rel, content])
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('TC-K11: env đã tước ⇒ export vẫn ra đúng kết quả', () => {
    const proc = Bun.spawnSync(['bun', 'scripts/i18n-export.ts'], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        HOME: '',
        DEV_TEAM_DASHBOARD_HOME: '/nonexistent',
        DEV_TEAM_BUNDLED_PLUGINS: '/nonexistent',
      },
    })
    expect(proc.exitCode).toBe(0)
    const flat = readYamlFile(path.join(OUT_DIR, 'vi.yaml'))
    expect(Object.keys(flat).length).toBe(diskKeyCount('vi'))
  })
})
