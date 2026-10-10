import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocaleMessages } from '@/frontend/plugins/i18n/loadLocales'
import { loadYaml } from '@/shared/lib/yamlLib'

/**
 * Nhóm E của `test-spec.md` — đường nạp ĐỒNG BỘ lúc module load.
 *
 * `loadLocaleMessages()` giữ hai vai: seed cho `createI18n` và fallback offline khi API
 * i18n chết. Chữ ký phải còn đồng bộ (TC-E03) — đó là điều kiện để 53 file test đi qua
 * `mountWithI18n` không phải sửa, và là lý do 🚫 không đụng `tests/src/helpers/i18n.ts`.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const LOCALES_DIR = path.join(REPO_ROOT, 'src/shared/locales')

function diskNamespaces(locale: string): string[] {
  return readdirSync(path.join(LOCALES_DIR, locale))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.slice(0, -'.yaml'.length))
    .sort()
}

describe('loadLocaleMessages — shape và nguồn dữ liệu', () => {
  it('TC-E01: trả `{ vi: {…}, en: {…} }`, mỗi locale là map namespace→messages', () => {
    const loaded = loadLocaleMessages()
    expect(Object.keys(loaded).sort()).toEqual(['en', 'vi'])
    for (const [locale, bucket] of Object.entries(loaded)) {
      expect(`${locale}:${typeof bucket}`).toBe(`${locale}:object`)
      expect(Object.keys(bucket).length).toBeGreaterThanOrEqual(15)
      for (const [ns, messages] of Object.entries(bucket)) {
        expect(`${locale}/${ns}`).toBe(`${locale}/${ns}`)
        expect(messages).toBeTypeOf('object')
        expect(Object.keys(messages as object).length).toBeGreaterThan(0)
      }
    }
  })

  it('TC-E02: namespace là camelCase theo tên file — 🚫 không còn khoá kebab', () => {
    const namespaces = Object.keys(loadLocaleMessages().vi)
    for (const expected of [
      'agentEditor',
      'pipelineEditor',
      'nlChat',
      'quickAction',
      'runningJobs',
      'common',
      'orchestrator',
    ]) {
      expect(namespaces).toContain(expected)
    }
    for (const ns of namespaces) {
      expect(`${ns}:${ns.includes('-')}`).toBe(`${ns}:false`)
    }
  })

  it('TC-E03: chữ ký vẫn ĐỒNG BỘ — giá trị trả về không phải Promise (D5)', () => {
    const result = loadLocaleMessages() as unknown as { then?: unknown }
    expect(typeof result.then).not.toBe('function')
    // Và dùng được ngay trong cùng lượt đồng bộ, không cần await.
    expect((loadLocaleMessages().vi.common as Record<string, unknown>).language).toBeDefined()
  })

  it('TC-E04: glob không rơi file — tập namespace == tập `.yaml` trên đĩa', () => {
    const loaded = loadLocaleMessages()
    for (const locale of Object.keys(loaded)) {
      expect(`${locale}: ${Object.keys(loaded[locale]).sort().join(',')}`).toBe(
        `${locale}: ${diskNamespaces(locale).join(',')}`,
      )
    }
  })

  it('TC-E05: giá trị khớp đúng nội dung file YAML trên đĩa', () => {
    const loaded = loadLocaleMessages()
    const samples: [string, string, string[]][] = [
      ['vi', 'common', ['language', 'title']],
      ['en', 'settings', ['language', 'loading']],
      ['vi', 'nlChat', ['builder', 'done']],
      // Khoá có dấu chấm cũ (`job.started`) nay là cây lồng.
      ['vi', 'automations', ['eventNames', 'job', 'started']],
      ['en', 'automations', ['eventNames', 'job', 'started']],
    ]
    for (const [locale, ns, keyPath] of samples) {
      const onDisk = loadYaml(readFileSync(path.join(LOCALES_DIR, locale, `${ns}.yaml`), 'utf8'))
      const pick = (root: unknown) =>
        keyPath.reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], root)
      expect(pick(loaded[locale][ns])).toBe(pick(onDisk))
      expect(pick(onDisk)).toBeTypeOf('string')
    }
  })

  it('TC-E05b: nguồn chỉ một định dạng — `src/shared/locales/<locale>/` không còn file `.json`', () => {
    for (const locale of readdirSync(LOCALES_DIR)) {
      const stray = readdirSync(path.join(LOCALES_DIR, locale)).filter((f) => !f.endsWith('.yaml'))
      expect(`${locale}: ${stray.join(',')}`).toBe(`${locale}: `)
    }
  })
})

/**
 * TC-E06 — MỘT NGUỒN SỰ THẬT.
 *
 * 🔒 Ca ĐẢO CHIỀU, cố ý để `.skip`: nó đỏ chừng nào 30 file `.ts` cũ còn tồn tại, và
 * chúng CÒN TỒN TẠI theo cổng chặn `test-spec.md` §8.1 (hạng mục #10 của `design.md`
 * §7 gate việc xoá sau cùng; nợ đã ghi ở `docs/todo/adhoc/T94b6ee41.md` mục A).
 *
 * Bật `.skip` này trong CHÍNH commit xoá 30 file đó — không sớm hơn, không muộn hơn.
 * Viết sẵn ở đây vì viết sau thì không ai nhớ.
 */
describe('TC-E06: một nguồn sự thật cho chuỗi dịch', () => {
  it.skip('🚫 không còn file locale `.ts` nào (bật cùng commit xoá — §8.1)', () => {
    const legacy: string[] = []

    const featuresDir = path.join(REPO_ROOT, 'src/features')
    for (const feature of readdirSync(featuresDir)) {
      const dir = path.join(featuresDir, feature, 'locales')
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir)) {
        if (file.endsWith('.ts')) legacy.push(`src/features/${feature}/locales/${file}`)
      }
    }

    const pluginLocales = path.join(REPO_ROOT, 'src/frontend/plugins/i18n/locales')
    if (existsSync(pluginLocales)) {
      const walk = (dir: string, rel: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}/${entry.name}`)
          else if (entry.name.endsWith('.ts')) legacy.push(`${rel}/${entry.name}`)
        }
      }
      walk(pluginLocales, 'src/frontend/plugins/i18n/locales')
    }

    expect(legacy.join('\n')).toBe('')
  })
})
