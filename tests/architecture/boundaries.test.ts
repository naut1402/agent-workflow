import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Bất biến của việc tách `src/api` + `src/core` → `src/{backend,frontend,shared}`.
 *
 * Toàn bộ nhóm này assert trên **đồ thị import transitive**, không phải import trực
 * tiếp: lỗi gốc của task là một đường *gián tiếp* (component Vue → business helper →
 * lib đọc file). Grep một tầng sẽ xanh giả ở đúng ca đã từng xảy ra thật.
 *
 * `import type` KHÔNG tính là cạnh — nó không tồn tại lúc runtime. `await import()`
 * thì CÓ tính: tree-shaking làm bundle sạch nhưng đồ thị vẫn bẩn, mà AC nói về code.
 */

const ROOT = path.resolve(import.meta.dir, '../..')
const SRC = path.join(ROOT, 'src')

const NODE_BUILTIN = /^(node:|bun:)/
/** Hạ tầng chỉ chạy được một phía — `src/shared/` chạm vào là hỏng mục đích bucket. */
const ONE_SIDED_PKG = /^(hono|drizzle-orm|drizzle-kit)(\/|$)/

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs|vue)$/.test(e.name)) out.push(p)
  }
  return out
}

const FILES = walk(SRC)

/** Bóc specifier ở dạng cạnh runtime. Bỏ `import type` / `export type`. */
function specifiersOf(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8')
  const specs: string[] = []
  const push = (s?: string) => { if (s) specs.push(s) }

  // import ... from '...'  /  export ... from '...'
  for (const m of text.matchAll(/\b(?:import|export)\b([\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g)) {
    const clause = m[1]
    // type-only ở mức câu lệnh: `import type {...} from` — bỏ hẳn
    if (/^\s*type\s/.test(clause)) continue
    // `import {}` rỗng sau khi bỏ specifier type: coi như type-only
    const named = clause.match(/\{([\s\S]*)\}/)
    if (named && named[1].trim() && named[1].split(',').every((x) => /^\s*type\s/.test(x) || !x.trim())) continue
    push(m[2])
  }
  // import 'side-effect'
  for (const m of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) push(m[1])
  // await import('...') — cạnh động vẫn là cạnh
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1])
  // import.meta.glob('pattern') — nạp động theo pattern, phải đi theo
  for (const m of text.matchAll(/import\.meta\.glob\s*\(\s*['"]([^'"]+)['"]/g)) push(m[1])

  return specs
}

/** Resolve specifier → path thật, hoặc nhãn 'builtin:x' / 'pkg:x'. */
function resolve(importer: string, spec: string): string[] {
  if (NODE_BUILTIN.test(spec)) return [`builtin:${spec}`]
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return [`pkg:${spec}`]

  const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : path.resolve(path.dirname(importer), spec)

  if (base.includes('*')) {
    // glob: so khớp thủ công trên danh sách file thật
    const rx = new RegExp('^' + base.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$')
    return FILES.filter((f) => rx.test(f))
  }
  const cands = [base, `${base}.ts`, `${base}.tsx`, `${base}.vue`, `${base}.js`, `${base}.mjs`,
                 base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'),
                 path.join(base, 'index.ts'), path.join(base, 'index.js')]
  for (const c of cands) if (fs.existsSync(c) && fs.statSync(c).isFile()) return [c]
  return []
}

const GRAPH = new Map<string, string[]>()
for (const f of FILES) GRAPH.set(f, specifiersOf(f).flatMap((s) => resolve(f, s)))

/** Duyệt transitive từ tập entry, trả về mọi node chạm tới (kể cả nhãn builtin/pkg). */
function reachable(entries: string[]): Set<string> {
  const seen = new Set<string>()
  const stack = [...entries]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const next of GRAPH.get(cur) ?? []) if (!seen.has(next)) stack.push(next)
  }
  return seen
}

/** Đường đi cụ thể entry → đích, để thông báo lỗi chỉ được chỗ phải sửa. */
function pathTo(entries: string[], hit: (n: string) => boolean): string[] | null {
  const prev = new Map<string, string>()
  const seen = new Set<string>(entries)
  const q = [...entries]
  while (q.length) {
    const cur = q.shift()!
    if (hit(cur) && !entries.includes(cur)) {
      const chain = [cur]
      let c = cur
      while (prev.has(c)) { c = prev.get(c)!; chain.unshift(c) }
      return chain.map((p) => (p.startsWith('builtin:') || p.startsWith('pkg:') ? p : path.relative(ROOT, p)))
    }
    for (const next of GRAPH.get(cur) ?? []) {
      if (seen.has(next)) continue
      seen.add(next); prev.set(next, cur); q.push(next)
    }
  }
  return null
}

const under = (p: string, bucket: string) => p.startsWith(path.join(SRC, bucket) + path.sep)

/** Entry FE: app root + mọi `.vue` + tầng FE của feature (spec: features/** cũng phải duyệt). */
const FE_ENTRIES = FILES.filter(
  (f) =>
    under(f, 'frontend') ||
    f.endsWith('.vue') ||
    /\/src\/features\/[^/]+\/(components|composables|scripts|locales|lib|schemas)\//.test(f) ||
    /\/src\/features\/[^/]+\/registerMode\.ts$/.test(f),
)

describe('TC-05 — không đường nào từ code FE tới module Node-only', () => {
  test('đồ thị import transitive từ entry FE không chạm node:/bun:', () => {
    const chain = pathTo(FE_ENTRIES, (n) => n.startsWith('builtin:'))
    expect(chain === null ? 'sạch' : `đường bẩn: ${chain.join(' → ')}`).toBe('sạch')
  })

  test('có entry FE thật để duyệt (chống xanh giả khi bộ lọc entry hỏng)', () => {
    expect(FE_ENTRIES.length).toBeGreaterThan(50)
  })
})

describe('TC-07 — biên hai chiều frontend ⟂ backend', () => {
  test('không file nào dưới src/frontend import src/backend', () => {
    const bad: string[] = []
    for (const f of FILES.filter((x) => under(x, 'frontend')))
      for (const t of GRAPH.get(f) ?? [])
        if (under(t, 'backend')) bad.push(`${path.relative(ROOT, f)} → ${path.relative(ROOT, t)}`)
    expect(bad).toEqual([])
  })

  test('không file nào dưới src/backend import src/frontend', () => {
    const bad: string[] = []
    for (const f of FILES.filter((x) => under(x, 'backend')))
      for (const t of GRAPH.get(f) ?? [])
        if (under(t, 'frontend')) bad.push(`${path.relative(ROOT, f)} → ${path.relative(ROOT, t)}`)
    expect(bad).toEqual([])
  })

  test('cạnh được tính sau khi RESOLVE, không phải grep chuỗi', () => {
    // Chốt chính cơ chế: dạng relative dài phải resolve về đúng file trong bucket.
    const client = path.join(SRC, 'frontend/http/client.ts')
    expect(fs.existsSync(client)).toBe(true)
    expect(resolve(path.join(SRC, 'features/x/scripts/a.ts'), '../../../frontend/http/client.js')).toEqual([client])
  })
})

describe('TC-08 — src/shared không phình thành "misc"', () => {
  const SHARED = FILES.filter((f) => under(f, 'shared') && !f.endsWith('.md'))

  test('có module shared để kiểm', () => {
    expect(SHARED.length).toBeGreaterThan(0)
  })

  test('shared không chạm node:/bun: kể cả gián tiếp', () => {
    const chain = pathTo(SHARED, (n) => n.startsWith('builtin:'))
    expect(chain === null ? 'sạch' : `đường bẩn: ${chain.join(' → ')}`).toBe('sạch')
  })

  test('shared không chạm hạ tầng một phía (hono / drizzle) kể cả gián tiếp', () => {
    const chain = pathTo(SHARED, (n) => n.startsWith('pkg:') && ONE_SIDED_PKG.test(n.slice(4)))
    expect(chain === null ? 'sạch' : `đường bẩn: ${chain.join(' → ')}`).toBe('sạch')
  })

  test('shared không import bucket khác', () => {
    const bad: string[] = []
    for (const f of SHARED)
      for (const t of GRAPH.get(f) ?? [])
        if (under(t, 'backend') || under(t, 'frontend'))
          bad.push(`${path.relative(ROOT, f)} → ${path.relative(ROOT, t)}`)
    expect(bad).toEqual([])
  })
})

describe('TC-09 — cổng chặn biên bắt được vi phạm mới (negative test)', () => {
  // Rule ở mức `warn` (eslint.config.js hạ error → warn toàn cục), nên assert theo
  // SỰ XUẤT HIỆN của message `no-restricted-imports`, KHÔNG theo exit code — assert
  // exit code ở đây sẽ xanh giả vĩnh viễn.
  const FIXTURES: Array<{ name: string; file: string; body: string }> = [
    {
      name: 'file trong src/frontend import module backend',
      file: 'src/frontend/__boundary_fixture__.ts',
      body: "import { logStore } from '../backend/log/store.js'\nexport const x = logStore\n",
    },
    {
      name: 'file trong src/frontend import node:fs',
      file: 'src/frontend/__boundary_fixture_node__.ts',
      body: "import fs from 'node:fs'\nexport const x = fs\n",
    },
    {
      name: 'file trong src/shared import node:path',
      file: 'src/shared/__boundary_fixture__.ts',
      body: "import path from 'node:path'\nexport const x = path\n",
    },
    {
      name: 'file trong src/features/*/schemas import backend (vùng từng lọt cổng)',
      file: 'src/features/settings/schemas/__boundary_fixture__.ts',
      body: "import { logStore } from '../../../backend/log/store.js'\nexport const x = logStore\n",
    },
  ]

  function lint(abs: string): Array<{ ruleId: string | null; message: string }> {
    let raw = ''
    try {
      raw = execFileSync('bunx', ['eslint', '--no-color', '--format', 'json', abs], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e: unknown) {
      // eslint exit ≠ 0 khi có error; stdout vẫn là JSON hợp lệ
      raw = String((e as { stdout?: string }).stdout ?? '')
    }
    const parsed = JSON.parse(raw) as Array<{ messages: Array<{ ruleId: string | null; message: string }> }>
    return parsed.flatMap((r) => r.messages)
  }

  for (const fx of FIXTURES) {
    test(`bắt được: ${fx.name}`, () => {
      const abs = path.join(ROOT, fx.file)
      expect(fs.existsSync(abs)).toBe(false) // không đè file thật
      fs.writeFileSync(abs, fx.body)
      try {
        const hits = lint(abs).filter((m) => m.ruleId === 'no-restricted-imports')
        expect(hits.length).toBeGreaterThan(0)
        // message phải nêu đúng luật bị phạm, không phải một cảnh báo bất kỳ
        expect(hits.some((m) => /frontend|backend|shared/i.test(m.message))).toBe(true)
      } finally {
        fs.rmSync(abs, { force: true }) // sót fixture làm đỏ lượt CI kế tiếp
      }
    })
  }

  test('fixture đã được dọn sạch', () => {
    for (const fx of FIXTURES) expect(fs.existsSync(path.join(ROOT, fx.file))).toBe(false)
  })
})
