#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { RUNNERS_FILE, readRunners } from './lib/runners.js'

const ROOT = path.resolve(import.meta.dir, '..', '..')

/** Đổi cả bộ máy build/test → phạm vi không còn tính được, phải chạy full. */
export const GLOBAL_FILES = [
  'package.json',
  'bun.lock',
  'vitest.config.ts',
  'vite.config.ts',
  'tsconfig.json',
  'playwright.config.ts',
  'eslint.config.js',
  RUNNERS_FILE,
]

const SOURCE_DIRS = ['src', 'mcp', 'tests']
const CODE_EXT = ['.ts', '.tsx', '.vue', '.mjs', '.js']

interface Args {
  base: string | null
  list: boolean
  catalog: boolean
  paths: string[]
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { base: null, list: false, catalog: false, paths: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') out.base = argv[++i] ?? null
    else if (a === '--list') out.list = true
    else if (a === '--catalog') out.catalog = true
    else out.paths.push(a)
  }
  return out
}

function git(...args: string[]): string {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  return r.status === 0 ? r.stdout : ''
}

function changedFiles(base: string | null): string[] {
  const out = new Set<string>()
  const add = (raw: string) => {
    for (const line of raw.split('\n')) {
      const f = line.trim()
      if (f) out.add(f)
    }
  }
  add(git('diff', '--name-only', 'HEAD'))
  add(git('ls-files', '--others', '--exclude-standard'))
  if (base) add(git('diff', '--name-only', `${base}...HEAD`))
  return [...out].filter((f) => fs.existsSync(path.join(ROOT, f)))
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      walk(p, acc)
    } else if (CODE_EXT.includes(path.extname(e.name))) {
      acc.push(path.relative(ROOT, p))
    }
  }
  return acc
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g

/** Specifier → path repo-relative, hoặc null nếu là package ngoài. */
export function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('.')) base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec)
  else if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice(2))
  else return null

  const candidates = [
    base,
    ...(base.endsWith('.js') ? [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.vue')] : []),
    `${base}.ts`,
    `${base}.vue`,
    `${base}.mjs`,
    path.join(base, 'index.ts'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.relative(ROOT, c)
  }
  return null
}

/** Cạnh import không thấy trong text: `apiServer.ts` nạp mọi `features/<name>/api.ts` lúc chạy. */
export function virtualEdges(files: string[]): Map<string, string[]> {
  const featureApis = files.filter((f) => /^src\/features\/[^/]+\/api\.ts$/.test(f))
  return new Map([['src/backend/apiServer.ts', featureApis]])
}

function buildImportGraph(files: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  const extra = virtualEdges(files)
  for (const f of files) {
    let text: string
    try {
      text = fs.readFileSync(path.join(ROOT, f), 'utf8')
    } catch {
      continue
    }
    const deps = new Set<string>(extra.get(f) ?? [])
    for (const m of text.matchAll(IMPORT_RE)) {
      const r = resolveSpecifier(f, m[1])
      if (r) deps.add(r)
    }
    graph.set(f, [...deps])
  }
  return graph
}

/** Test file có chạm (transitive) vào bất kỳ file nào trong `targets` không? */
export function reaches(start: string, graph: Map<string, string[]>, targets: Set<string>): boolean {
  const seen = new Set<string>([start])
  const stack = [start]
  while (stack.length) {
    const cur = stack.pop()!
    for (const dep of graph.get(cur) ?? []) {
      if (targets.has(dep)) return true
      if (!seen.has(dep)) {
        seen.add(dep)
        stack.push(dep)
      }
    }
  }
  return false
}

function bunOwnedPrefixes(): string[] {
  return readRunners(ROOT).bunTest
}

export function isUnder(file: string, prefixes: string[]): boolean {
  return prefixes.some((p) => file === p || file.startsWith(`${p}/`))
}

/** Suite = thư mục gom test; với feature lấy thêm một tầng (`business`, `components`, …). */
export function suiteOf(testFile: string): string {
  const seg = testFile.split('/')
  if (seg[1] === 'mcp' || seg.length <= 3) return seg.slice(0, -1).join('/')
  const depth = seg[2] === 'features' ? 5 : 4
  return seg.slice(0, Math.min(depth, seg.length - 1)).join('/')
}

/** `src/features/automations/business/x.ts` → `features/automations/business`. */
export function areaOf(sourceFile: string): string | null {
  const seg = sourceFile.split('/')
  if (seg[0] === '.github') return 'tooling'
  if (seg[0] !== 'src' && seg[0] !== 'mcp') return null
  if (seg[0] === 'mcp') return 'mcp'
  if (seg[1] === 'features') return seg.slice(1, 4).join('/')
  return seg.slice(1, 3).join('/')
}

const CATALOG_HEADER = [
  '# Danh mục suite test',
  '',
  'Bảng **sinh tự động** — đừng sửa tay:',
  '',
  '```bash',
  'bun run test:scope --catalog > tests/CATALOG.md',
  '```',
  '',
  'Sinh **sau khi đã overlay** cây test: `--catalog` cần đồng thời `package.json` /',
  '`vitest.config.ts` của dòng source và cây `tests/` của dòng test.',
  '',
  '- **Runner** — theo `tests/runners.json` (khoá `bunTest`); phần còn lại là vitest.',
  '- **Vùng source phủ** — lấy từ import **trực tiếp** của test trong suite: nó nói',
  '  suite đó *của* module nào, không phải toàn bộ closure.',
  '- **Suite không có mặt trong bảng** = vùng đó chưa ai test. `bun run test:scope`',
  '  chọn ra 0 file **không** phải "đã xanh".',
  '',
  'Quy ước: [`docs/agent-rules/testing.md`](../docs/agent-rules/testing.md) §3–§4.',
  '',
]

function printCatalog(testFiles: string[], graph: Map<string, string[]>, bunPrefixes: string[]): void {
  const suites = new Map<string, string[]>()
  for (const t of testFiles) {
    const s = suiteOf(t)
    suites.set(s, [...(suites.get(s) ?? []), t])
  }

  for (const line of CATALOG_HEADER) console.log(line)
  console.log('| Suite | Runner | Vùng source phủ | Số file | Lệnh chạy |')
  console.log('|---|---|---|---|---|')
  for (const suite of [...suites.keys()].sort()) {
    const files = suites.get(suite)!
    const bun = files.every((f) => isUnder(f, bunPrefixes))
    const areas = new Map<string, number>()
    for (const f of files) {
      for (const dep of graph.get(f) ?? []) {
        const a = areaOf(dep)
        if (a) areas.set(a, (areas.get(a) ?? 0) + 1)
      }
    }
    const top = [...areas.entries()]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, 3)
      .map(([a]) => `\`${a}\``)
      .join(', ')
    const hasChildSuite = [...suites.keys()].some((k) => k !== suite && k.startsWith(`${suite}/`))
    const target = hasChildSuite ? `${suite}/*.test.ts` : suite
    const cmd = bun ? `bun test ${target}` : `npx vitest run ${target}`
    console.log(`| \`${suite}\` | ${bun ? 'bun' : 'vitest'} | ${top || '—'} | ${files.length} | \`${cmd}\` |`)
  }
}

/** Chọn test file cho một tập file đã đổi, tách sẵn theo runner. */
export function selectTests(
  testFiles: string[],
  graph: Map<string, string[]>,
  targets: Set<string>,
  bunPrefixes: string[],
): { bun: string[]; vitest: string[] } {
  const selected = testFiles.filter((t) => targets.has(t) || reaches(t, graph, targets))
  return {
    bun: selected.filter((f) => isUnder(f, bunPrefixes)),
    vitest: selected.filter((f) => !isUnder(f, bunPrefixes)),
  }
}

/** File/thư mục người dùng truyền vào (hoặc git trả về) → tập file code cụ thể. */
export function expandTargets(changed: string[], listDir: (abs: string) => string[]): Set<string> {
  const targets = new Set<string>()
  for (const c of changed) {
    const abs = path.join(ROOT, c)
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) listDir(abs).forEach((f) => targets.add(f))
    else if (CODE_EXT.includes(path.extname(c))) targets.add(c)
  }
  return targets
}

function scanRepo(): { graph: Map<string, string[]>; testFiles: string[] } {
  const allFiles = SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
  return {
    graph: buildImportGraph(allFiles),
    testFiles: allFiles.filter((f) => /\.(test|spec)\.ts$/.test(f) && f.startsWith('tests/')),
  }
}

function run(cmd: string, args: string[]): number {
  console.log(`\n$ ${cmd} ${args.join(' ')}\n`)
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })
  return r.status ?? 1
}

function main(): number {
  const args = parseArgs(process.argv.slice(2))

  if (args.catalog) {
    const { graph, testFiles } = scanRepo()
    printCatalog(testFiles, graph, bunOwnedPrefixes())
    return 0
  }

  const changed = args.paths.length ? args.paths : changedFiles(args.base)
  if (!changed.length) {
    console.log('test-scope: không có thay đổi nào — bỏ qua (dùng `bun run test` nếu muốn chạy full).')
    return 0
  }

  const global = changed.filter((f) => GLOBAL_FILES.includes(f))
  if (global.length) {
    console.log(`test-scope: đổi ${global.join(', ')} → phạm vi không tính được, chạy full.`)
    if (args.list) return 0
    return run('bun', ['run', 'test']) || run('bun', ['run', 'test:fe'])
  }

  const targets = expandTargets(changed, walk)
  if (!targets.size) {
    console.log('test-scope: thay đổi không chạm file code nào (doc/config) — không có suite nào để chạy.')
    return 0
  }

  const { graph, testFiles } = scanRepo()
  const { bun: bunTests, vitest: viteTests } = selectTests(testFiles, graph, targets, bunOwnedPrefixes())

  console.log(`test-scope: ${targets.size} file đổi → ${bunTests.length + viteTests.length} test file`)
  console.log(`  bun test : ${bunTests.length}`)
  for (const f of bunTests) console.log(`    - ${f}`)
  console.log(`  vitest   : ${viteTests.length}`)
  for (const f of viteTests) console.log(`    - ${f}`)

  if (!bunTests.length && !viteTests.length) {
    console.log(
      '\ntest-scope: không test nào import tới vùng đã đổi. Vùng này đang KHÔNG có test —\n' +
        'viết test trước (test-convention.md §3), đừng coi đây là "đã xanh".',
    )
    return 0
  }
  if (args.list) return 0

  let code = 0
  if (bunTests.length) code = run('bun', ['test', ...bunTests]) || code
  if (viteTests.length) code = run('npx', ['vitest', 'run', ...viteTests]) || code
  return code
}

if (import.meta.main) {
  try {
    process.exit(main())
  } catch (e) {
    console.error(`test-scope: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
