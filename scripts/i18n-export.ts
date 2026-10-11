#!/usr/bin/env bun
// Gộp `src/shared/locales/<locale>/*.yaml` thành một file YAML phẳng mỗi locale
// (`out/i18n/<locale>.yaml`), khoá dạng `namespace.a.b.c`.
//
//   bun run i18n:export                # mọi locale
//   bun run i18n:export --locale=en    # chỉ một locale
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dumpYaml, loadYaml } from '../src/shared/lib/yamlLib'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const LOCALES_DIR = join(REPO_ROOT, 'src/shared/locales')
const OUT_DIR = join(REPO_ROOT, 'out/i18n')

function fail(message: string): never {
  console.error(`[i18n:export] ${message}`)
  process.exit(1)
}

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
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()) {
    const namespace = file.slice(0, -'.yaml'.length)
    flatten(loadYaml(readFileSync(join(dir, file), 'utf8')), namespace, flat)
  }
  const target = join(OUT_DIR, `${locale}.yaml`)
  writeFileSync(target, dumpYaml(flat, { sortKeys: true, lineWidth: -1 }))
  console.log(`[i18n:export] ${target} — ${Object.keys(flat).length} khoá`)
}
