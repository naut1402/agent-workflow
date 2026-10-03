#!/usr/bin/env bun
// Nhận file JSON phẳng người biên dịch trả về, tách theo segment đầu (namespace) và
// ghi ngược về `src/shared/locales/<locale>/<namespace>.json`.
//
//   bun run i18n:import --locale=en out/i18n/en.json
//
// Hai bất biến:
// - CHỈ ghi đè khoá CÓ trong file vendor; khoá vắng mặt giữ nguyên giá trị cũ. Mất khoá
//   do import là lỗi không hồi phục được, còn thiếu bản dịch thì fallback lo.
// - File đầu vào hỏng → KHÔNG ghi gì. Nguồn sự thật không được hỏng vì một file xấu.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const LOCALES_DIR = join(REPO_ROOT, 'src/shared/locales')

function fail(message: string): never {
  console.error(`[i18n:import] ${message}`)
  process.exit(1)
}

const localeArg = process.argv.find((a) => a.startsWith('--locale='))?.slice('--locale='.length)
const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!localeArg) fail('thiếu --locale=<mã locale>')
if (!fileArg) fail('thiếu đường dẫn file JSON phẳng')

const localeDir = join(LOCALES_DIR, localeArg)
if (!existsSync(localeDir)) fail(`locale '${localeArg}' không tồn tại (${localeDir})`)

let flat: Record<string, unknown>
try {
  const parsed = JSON.parse(readFileSync(fileArg, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${fileArg} không phải object JSON phẳng`)
  }
  flat = parsed as Record<string, unknown>
} catch (err) {
  fail(`không đọc được ${fileArg}: ${err instanceof Error ? err.message : String(err)}`)
}

const known = new Set(
  readdirSync(localeDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length)),
)

/** Ghi `a.b.c` vào cây; tạo nhánh trung gian khi thiếu. */
function setPath(tree: Record<string, unknown>, path: string[], value: string): void {
  let node = tree
  for (const seg of path.slice(0, -1)) {
    const next = node[seg]
    if (!next || typeof next !== 'object' || Array.isArray(next)) node[seg] = {}
    node = node[seg] as Record<string, unknown>
  }
  node[path[path.length - 1]] = value
}

function sortDeep(v: unknown): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    out[k] = sortDeep((v as Record<string, unknown>)[k])
  }
  return out
}

// Gom theo namespace TRƯỚC khi ghi — không file nào bị đụng nếu khâu gom có vấn đề.
const byNamespace = new Map<string, Record<string, unknown>>()
const skipped: string[] = []
let applied = 0

for (const [flatKey, value] of Object.entries(flat)) {
  const segments = flatKey.split('.')
  const namespace = segments[0]
  if (segments.length < 2 || !known.has(namespace)) {
    // Namespace lạ → bỏ qua, KHÔNG tạo file namespace mới.
    skipped.push(flatKey)
    continue
  }
  if (!byNamespace.has(namespace)) {
    byNamespace.set(
      namespace,
      JSON.parse(readFileSync(join(localeDir, `${namespace}.json`), 'utf8')),
    )
  }
  setPath(byNamespace.get(namespace)!, segments.slice(1), String(value))
  applied++
}

for (const [namespace, tree] of byNamespace) {
  writeFileSync(join(localeDir, `${namespace}.json`), JSON.stringify(sortDeep(tree), null, 2) + '\n')
}

console.log(
  `[i18n:import] ${localeArg}: ${applied} khoá vào ${byNamespace.size} namespace` +
    (skipped.length ? `; bỏ qua ${skipped.length} khoá namespace lạ` : ''),
)
for (const key of skipped) console.warn(`[i18n:import] bỏ qua khoá namespace lạ: ${key}`)
