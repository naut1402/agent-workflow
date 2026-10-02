#!/usr/bin/env bun
// Ghi file YAML phẳng người biên dịch trả về ngược vào
// `src/shared/locales/<locale>/<namespace>.yaml`, tách theo segment đầu (namespace).
// Chỉ ghi đè khoá có trong file đầu vào; namespace lạ bị bỏ qua; file hỏng thì không ghi gì.
//
//   bun run i18n:import --locale=en out/i18n/en.yaml
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dumpYaml, loadYaml } from '../src/shared/lib/yamlLib'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const LOCALES_DIR = join(REPO_ROOT, 'src/shared/locales')

function fail(message: string): never {
  console.error(`[i18n:import] ${message}`)
  process.exit(1)
}

const localeArg = process.argv.find((a) => a.startsWith('--locale='))?.slice('--locale='.length)
const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!localeArg) fail('thiếu --locale=<mã locale>')
if (!fileArg) fail('thiếu đường dẫn file YAML phẳng')

const localeDir = join(LOCALES_DIR, localeArg)
if (!existsSync(localeDir)) fail(`locale '${localeArg}' không tồn tại (${localeDir})`)

let flat: Record<string, unknown>
try {
  const parsed = loadYaml(readFileSync(fileArg, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${fileArg} không phải mapping YAML phẳng`)
  }
  flat = parsed as Record<string, unknown>
} catch (err) {
  fail(`không đọc được ${fileArg}: ${err instanceof Error ? err.message : String(err)}`)
}

const known = new Set(
  readdirSync(localeDir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.slice(0, -'.yaml'.length)),
)

function setPath(tree: Record<string, unknown>, path: string[], value: string): void {
  let node = tree
  for (const seg of path.slice(0, -1)) {
    const next = node[seg]
    if (!next || typeof next !== 'object' || Array.isArray(next)) node[seg] = {}
    node = node[seg] as Record<string, unknown>
  }
  node[path[path.length - 1]] = value
}

const byNamespace = new Map<string, Record<string, unknown>>()
const skipped: string[] = []
let applied = 0

for (const [flatKey, value] of Object.entries(flat)) {
  const segments = flatKey.split('.')
  const namespace = segments[0]
  if (segments.length < 2 || !known.has(namespace)) {
    skipped.push(flatKey)
    continue
  }
  if (!byNamespace.has(namespace)) {
    const raw = loadYaml(readFileSync(join(localeDir, `${namespace}.yaml`), 'utf8'))
    byNamespace.set(namespace, (raw ?? {}) as Record<string, unknown>)
  }
  setPath(byNamespace.get(namespace)!, segments.slice(1), String(value))
  applied++
}

for (const [namespace, tree] of byNamespace) {
  writeFileSync(join(localeDir, `${namespace}.yaml`), dumpYaml(tree, { lineWidth: -1 }))
}

console.log(
  `[i18n:import] ${localeArg}: ${applied} khoá vào ${byNamespace.size} namespace` +
    (skipped.length ? `; bỏ qua ${skipped.length} khoá namespace lạ` : ''),
)
for (const key of skipped) console.warn(`[i18n:import] bỏ qua khoá namespace lạ: ${key}`)
