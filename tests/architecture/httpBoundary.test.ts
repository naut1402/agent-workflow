import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * #508 — ranh giới HTTP: FE chỉ `import type` từ controller / business; `mcp/` chỉ
 * `import type` từ controller. Rule ở mức `warn` nên assert theo SỰ XUẤT HIỆN của message
 * `@typescript-eslint/no-restricted-imports`, không theo exit code (giống TC-09).
 */

const ROOT = path.resolve(import.meta.dir, '../..')
const RULE = '@typescript-eslint/no-restricted-imports'

function lint(abs: string): Array<{ ruleId: string | null; message: string }> {
  let raw = ''
  try {
    raw = execFileSync('bunx', ['eslint', '--no-color', '--format', 'json', abs], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e: unknown) {
    raw = String((e as { stdout?: string }).stdout ?? '')
  }
  const parsed = JSON.parse(raw) as Array<{ messages: Array<{ ruleId: string | null; message: string }> }>
  return parsed.flatMap((r) => r.messages)
}

const FIXTURES: Array<{ name: string; file: string; body: string; hit: boolean }> = [
  {
    name: 'component import giá trị từ controller',
    file: 'src/features/statistics/components/__http_boundary_fixture__.ts',
    body: "import { StatisticsController } from '../controller.js'\nexport const x = StatisticsController\n",
    hit: true,
  },
  {
    name: 'script import giá trị từ business',
    file: 'src/features/statistics/scripts/__http_boundary_fixture__.ts',
    body: "import { MAX_GROUPS } from '../business/usageStats.js'\nexport const x = MAX_GROUPS\n",
    hit: true,
  },
  {
    name: 'src/frontend import giá trị từ controller feature',
    file: 'src/frontend/__http_boundary_fixture__.ts',
    body: "import { UsageStatsRequest } from '../features/statistics/controller.js'\nexport const x = UsageStatsRequest\n",
    hit: true,
  },
  {
    name: 'component chỉ import type từ controller + business (được phép)',
    file: 'src/features/statistics/components/__http_boundary_fixture_type__.ts',
    body:
      "import type { UsageStatsRequest } from '../controller.js'\n" +
      "import { type StatisticsBusiness } from '../business/index.js'\n" +
      'export type X = UsageStatsRequest | StatisticsBusiness\n',
    hit: false,
  },
  {
    name: 'component import schemas (được phép)',
    file: 'src/features/statistics/components/__http_boundary_fixture_schema__.ts',
    body: "import { USAGE_METRICS } from '../schemas/usageStats.js'\nexport const x = USAGE_METRICS\n",
    hit: false,
  },
  {
    name: 'mcp/ import giá trị từ controller',
    file: 'mcp/tools/__http_boundary_fixture__.ts',
    body: "import { StatisticsController } from '../../src/features/statistics/controller.js'\nexport const x = StatisticsController\n",
    hit: true,
  },
  {
    name: 'mcp/ import type từ controller (được phép)',
    file: 'mcp/tools/__http_boundary_fixture_type__.ts',
    body: "import type { UsageStatsRequest } from '../../src/features/statistics/controller.js'\nexport type X = UsageStatsRequest\n",
    hit: false,
  },
]

describe('#508 — FE · mcp/ ⟂ controller (lint)', () => {
  for (const fx of FIXTURES) {
    test(`${fx.hit ? 'bắt được' : 'không báo'}: ${fx.name}`, () => {
      const abs = path.join(ROOT, fx.file)
      expect(fs.existsSync(abs)).toBe(false)
      fs.writeFileSync(abs, fx.body)
      try {
        const hits = lint(abs).filter((m) => m.ruleId === RULE)
        if (fx.hit) {
          expect(hits.length).toBeGreaterThan(0)
          expect(hits.some((m) => /import type/.test(m.message))).toBe(true)
        } else {
          expect(hits).toEqual([])
        }
      } finally {
        fs.rmSync(abs, { force: true })
      }
    })
  }

  test('fixture đã được dọn sạch', () => {
    for (const fx of FIXTURES) expect(fs.existsSync(path.join(ROOT, fx.file))).toBe(false)
  })
})
