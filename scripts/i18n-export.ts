#!/usr/bin/env bun
// Gộp `src/shared/locales/<locale>/*.json` thành MỘT file JSON phẳng mỗi locale
// (`out/i18n/<locale>.json`), khoá dạng `namespace.a.b.c`. Đây là file duy nhất
// gửi người biên dịch — họ không phải mở TypeScript hay đi 16 thư mục.
//
//   bun run i18n:export                # mọi locale
//   bun run i18n:export --locale=en    # chỉ một locale
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const LOCALES_DIR = join(REPO_ROOT, 'src/shared/locales')
const OUT_DIR = join(REPO_ROOT, 'out/i18n')

function fail(message: string): never {
  console.error(`[i18n:export] ${message}`)
  process.exit(1)
}

/** `{a:{b:'x'}}` → `{'ns.a.b':'x'}`. Chỉ lá chuỗi — cây locale không có mảng. */
function flatten(obj: unknown, prefix: string, out: Record<string, string>): void {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out[key] = String(v)
  }
}

const localeArg = process.argv.find((a) => a.startsWith('--locale='))?.slice('--locale='.length)

if (!existsSync(LOCALES_DIR)) fail(`không tìm thấy ${LOCALES_DIR}`)
const available = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

if (localeArg && !available.includes(localeArg)) {
  fail(`locale '${localeArg}' không tồn tại. Hiện có: ${available.join(', ')}`)
}
const locales = localeArg ? [localeArg] : available
if (locales.length === 0) fail(`không có locale nào trong ${LOCALES_DIR}`)

mkdirSync(OUT_DIR, { recursive: true })

for (const locale of locales) {
  const dir = join(LOCALES_DIR, locale)
  const flat: Record<string, string> = {}
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const namespace = file.slice(0, -'.json'.length)
    flatten(JSON.parse(readFileSync(join(dir, file), 'utf8')), namespace, flat)
  }
  // Khoá đã sort → chạy 2 lần ra file giống hệt, vendor không nhận "thay đổi ảo".
  const sorted: Record<string, string> = {}
  for (const k of Object.keys(flat).sort()) sorted[k] = flat[k]
  const target = join(OUT_DIR, `${locale}.json`)
  writeFileSync(target, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`[i18n:export] ${target} — ${Object.keys(sorted).length} khoá`)
}
