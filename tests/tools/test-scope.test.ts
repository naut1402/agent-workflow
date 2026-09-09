import { describe, expect, test } from 'bun:test'
import {
  areaOf,
  expandTargets,
  isUnder,
  parseArgs,
  reaches,
  resolveSpecifier,
  selectTests,
  suiteOf,
  virtualEdges,
} from '../../.github/scripts/test-scope.js'

/**
 * `test-scope` quyết định **test nào được chạy** ở vòng lặp local. Nó chọn sai
 * thì hậu quả im lặng: dev tưởng đã chạy đủ, bug đi thẳng tới CI. Nên các hàm
 * thuần quyết định việc chọn đều phải có test, đặc biệt hai bất biến:
 *  - chọn thiếu là hỏng (bỏ sót test), chọn thừa chỉ tốn thời gian;
 *  - suite phải map đúng runner, vì `business` (bun) và `components` (vitest)
 *    nằm cùng một feature.
 */

describe('parseArgs', () => {
  test('không cờ nào → path list, không bật chế độ nào', () => {
    expect(parseArgs(['src/a.ts', 'src/b.ts'])).toEqual({
      base: null,
      list: false,
      catalog: false,
      paths: ['src/a.ts', 'src/b.ts'],
    })
  })

  test('--base lấy giá trị kế tiếp, không coi nó là path', () => {
    const a = parseArgs(['--base', 'origin/main', 'src/a.ts'])
    expect(a.base).toBe('origin/main')
    expect(a.paths).toEqual(['src/a.ts'])
  })

  test('--list và --catalog bật độc lập', () => {
    expect(parseArgs(['--list']).list).toBe(true)
    expect(parseArgs(['--catalog']).catalog).toBe(true)
  })

  test('--base ở cuối, thiếu giá trị → null chứ không nuốt undefined thành path', () => {
    const a = parseArgs(['--base'])
    expect(a.base).toBe(null)
    expect(a.paths).toEqual([])
  })
})

describe('resolveSpecifier', () => {
  // Repo import kiểu ESM: nguồn là .ts nhưng specifier ghi .js.
  test('specifier tương đối .js trỏ về file .ts thật', () => {
    expect(resolveSpecifier('src/features/automations/controller.ts', './business/runAction.js')).toBe(
      'src/features/automations/business/runAction.ts',
    )
  })

  test('alias @/ trỏ vào src/', () => {
    expect(resolveSpecifier('tests/src/features/automations/composables/x.test.ts', '@/features/automations/composables/useAutomations')).toBe(
      'src/features/automations/composables/useAutomations.ts',
    )
  })

  test('alias @configs/ trỏ vào src/core/configs', () => {
    expect(resolveSpecifier('src/App.vue', '@configs/appSettings.js')).toBe('src/core/configs/appSettings.ts')
  })

  test('alias trỏ file không tồn tại → null, không bịa ra path', () => {
    expect(resolveSpecifier('src/App.vue', '@configs/index.js')).toBe(null)
  })

  test('import .vue giữ nguyên đuôi', () => {
    expect(resolveSpecifier('tests/src/App.test.ts', '@/App.vue')).toBe('src/App.vue')
  })

  test('package ngoài → null (không dựng cạnh rác)', () => {
    expect(resolveSpecifier('src/api/apiServer.ts', 'hono')).toBe(null)
    expect(resolveSpecifier('src/api/apiServer.ts', 'node:fs')).toBe(null)
  })

  test('path tương đối không tồn tại → null', () => {
    expect(resolveSpecifier('src/api/apiServer.ts', './khong-co-that.js')).toBe(null)
  })
})

describe('virtualEdges — nạp động không có trong text', () => {
  test('apiServer nối tới mọi features/<name>/api.ts', () => {
    const edges = virtualEdges([
      'src/api/apiServer.ts',
      'src/features/automations/api.ts',
      'src/features/monitor/api.ts',
      'src/features/monitor/controller.ts',
      'src/features/monitor/business/x.ts',
    ])
    expect(edges.get('src/api/apiServer.ts')).toEqual([
      'src/features/automations/api.ts',
      'src/features/monitor/api.ts',
    ])
  })

  test('không có api.ts nào → cạnh rỗng, không throw', () => {
    expect(virtualEdges(['src/api/apiServer.ts']).get('src/api/apiServer.ts')).toEqual([])
  })
})

describe('reaches — bắt phụ thuộc bắc cầu', () => {
  const graph = new Map<string, string[]>([
    ['tests/a.test.ts', ['src/controller.ts']],
    ['src/controller.ts', ['src/business.ts']],
    ['src/business.ts', ['src/helper.ts']],
    ['tests/b.test.ts', ['src/khac.ts']],
  ])

  test('đi qua nhiều tầng vẫn tới đích', () => {
    expect(reaches('tests/a.test.ts', graph, new Set(['src/helper.ts']))).toBe(true)
  })

  test('không có đường đi → false', () => {
    expect(reaches('tests/b.test.ts', graph, new Set(['src/helper.ts']))).toBe(false)
  })

  test('đồ thị có vòng lặp không làm treo', () => {
    const cyclic = new Map<string, string[]>([
      ['tests/c.test.ts', ['src/x.ts']],
      ['src/x.ts', ['src/y.ts']],
      ['src/y.ts', ['src/x.ts']],
    ])
    expect(reaches('tests/c.test.ts', cyclic, new Set(['src/z.ts']))).toBe(false)
  })
})

describe('isUnder — phân runner theo prefix', () => {
  const prefixes = ['tests/src/server', 'tests/src/features/monitor/business', 'tests/mcp']

  test('file trong thư mục prefix → thuộc prefix đó', () => {
    expect(isUnder('tests/src/server/http/app.test.ts', prefixes)).toBe(true)
    expect(isUnder('tests/src/features/monitor/business/x.test.ts', prefixes)).toBe(true)
  })

  test('trùng tiền tố chuỗi nhưng khác thư mục → không thuộc', () => {
    expect(isUnder('tests/src/servers/x.test.ts', prefixes)).toBe(false)
    expect(isUnder('tests/src/features/monitor/components/x.test.ts', prefixes)).toBe(false)
  })
})

describe('suiteOf — gom test thành suite', () => {
  test('feature tách tới tầng layer: business (bun) và components (vitest) là 2 suite', () => {
    expect(suiteOf('tests/src/features/monitor/business/tasks/runStep.test.ts')).toBe(
      'tests/src/features/monitor/business',
    )
    expect(suiteOf('tests/src/features/monitor/components/Panel.test.ts')).toBe(
      'tests/src/features/monitor/components',
    )
  })

  test('server/core gom ở tầng khu vực, thư mục con thu về cha', () => {
    expect(suiteOf('tests/src/server/http/security/jwt.test.ts')).toBe('tests/src/server/http')
    expect(suiteOf('tests/src/core/ui/CSelect.test.ts')).toBe('tests/src/core/ui')
  })

  test('file nằm ngay dưới thư mục gốc → chính thư mục đó', () => {
    expect(suiteOf('tests/src/server/registry.test.ts')).toBe('tests/src/server')
    expect(suiteOf('tests/mcp/server.test.ts')).toBe('tests/mcp')
    expect(suiteOf('tests/src/App.test.ts')).toBe('tests/src')
  })
})

describe('areaOf — quy source về khu vực hiển thị', () => {
  test('feature giữ tới tầng layer', () => {
    expect(areaOf('src/features/automations/business/runAction.ts')).toBe('features/automations/business')
  })

  test('core giữ tới tầng module', () => {
    expect(areaOf('src/core/lib/fileHelper.ts')).toBe('core/lib')
  })

  test('mcp gom về một khu vực', () => {
    expect(areaOf('mcp/server.ts')).toBe('mcp')
  })

  test('script tooling có khu vực riêng', () => {
    expect(areaOf('.github/scripts/test-scope.ts')).toBe('tooling')
  })

  test('ngoài src/ và mcp/ → null (không lên bảng)', () => {
    expect(areaOf('tests/src/server/x.test.ts')).toBe(null)
    expect(areaOf('docs/architecture.md')).toBe(null)
  })
})

describe('selectTests — quyết định chạy gì', () => {
  const graph = new Map<string, string[]>([
    ['tests/src/server/automations/runAction.test.ts', ['src/features/automations/business/runAction.ts']],
    ['tests/src/features/automations/components/Panel.test.ts', ['src/features/automations/components/Panel.vue']],
    ['tests/src/features/monitor/business/x.test.ts', ['src/features/monitor/business/x.ts']],
    ['src/features/automations/components/Panel.vue', ['src/features/automations/scripts/api.ts']],
  ])
  const testFiles = [
    'tests/src/server/automations/runAction.test.ts',
    'tests/src/features/automations/components/Panel.test.ts',
    'tests/src/features/monitor/business/x.test.ts',
  ]
  const bunPrefixes = ['tests/src/server', 'tests/src/features/monitor/business']

  test('sửa business backend → chỉ suite bun, vitest rỗng', () => {
    const r = selectTests(testFiles, graph, new Set(['src/features/automations/business/runAction.ts']), bunPrefixes)
    expect(r.bun).toEqual(['tests/src/server/automations/runAction.test.ts'])
    expect(r.vitest).toEqual([])
  })

  test('sửa file FE bắc cầu qua component → chỉ suite vitest', () => {
    const r = selectTests(testFiles, graph, new Set(['src/features/automations/scripts/api.ts']), bunPrefixes)
    expect(r.bun).toEqual([])
    expect(r.vitest).toEqual(['tests/src/features/automations/components/Panel.test.ts'])
  })

  test('cùng feature nhưng khác layer thì khác runner — không gom nhầm', () => {
    const r = selectTests(testFiles, graph, new Set(['src/features/monitor/business/x.ts']), bunPrefixes)
    expect(r.bun).toEqual(['tests/src/features/monitor/business/x.test.ts'])
    expect(r.vitest).toEqual([])
  })

  test('sửa chính test file → test đó được chọn dù không import gì', () => {
    const r = selectTests(testFiles, graph, new Set(['tests/src/features/monitor/business/x.test.ts']), bunPrefixes)
    expect(r.bun).toEqual(['tests/src/features/monitor/business/x.test.ts'])
  })

  test('vùng không ai import → rỗng cả hai (caller phải cảnh báo, không im lặng)', () => {
    const r = selectTests(testFiles, graph, new Set(['src/standalone.ts']), bunPrefixes)
    expect(r.bun).toEqual([])
    expect(r.vitest).toEqual([])
  })
})

describe('expandTargets', () => {
  test('bỏ file không phải code (doc, config yaml)', () => {
    const t = expandTargets(['docs/architecture.md', 'src/App.vue'], () => [])
    expect([...t]).toEqual(['src/App.vue'])
  })

  test('thư mục được nở ra thành file bên trong', () => {
    const t = expandTargets(['src/features/automations'], () => [
      'src/features/automations/controller.ts',
      'src/features/automations/api.ts',
    ])
    expect([...t]).toEqual(['src/features/automations/controller.ts', 'src/features/automations/api.ts'])
  })
})
