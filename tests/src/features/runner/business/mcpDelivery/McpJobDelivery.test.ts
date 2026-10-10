import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { McpRegistry, mcpRegistry } from '../../../../../../src/features/mcp/business/index.js'
import type { McpServer, McpServerSet } from '../../../../../../src/features/mcp/business/index.js'
import { McpJobDelivery, type McpJobInput } from '../../../../../../src/features/runner/business/mcpDelivery/McpJobDelivery.js'
import { NoMcpDelivery } from '../../../../../../src/features/runner/business/mcpDelivery/NoMcpDelivery.js'

/**
 * Template Method `McpJobDelivery.prepare` — trình tự cố định entry tự gắn →
 * chọn server → giao, và bất biến `null` (G9): không `ids` VÀ không extras, hoặc
 * mọi id đều rụng ⇒ `null` TRƯỚC `attach`, nên không hiện thực nào chạm đĩa / mở
 * phiên ở đường mặc định của mọi job thường.
 *
 * Bề mặt: số lần `attach` được gọi và bộ server nó nhận — đo bằng một hiện thực
 * ghi lại lời gọi, 🚫 mock registry: store thật dưới `DEV_TEAM_DASHBOARD_HOME` tạm.
 */

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-delivery-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

function seed(id: string, enabled = true) {
  const res = mcpRegistry.upsert({ id, label: id, enabled, transport: 'stdio', command: 'npx', args: [], env: {} })
  expect(res.ok).toBe(true)
}

function stdio(id: string): McpServer {
  return McpRegistry.normalise({ id, label: id, enabled: true, transport: 'stdio', command: 'bun', args: [], env: {} })!
}

/** Hiện thực ghi lại mọi lời gọi `attach` — handle là danh sách id nhận được. */
class RecordingDelivery extends McpJobDelivery<string[]> {
  readonly kind = 'config-file-flag' as const
  readonly attached: { ids: string[]; input: McpJobInput }[] = []

  constructor(
    private readonly extras: McpServer[] = [],
    private readonly result: 'ids' | 'null' = 'ids',
  ) {
    super()
  }

  protected override extraServers(): McpServer[] {
    return this.extras
  }

  protected attach(set: McpServerSet, input: McpJobInput): string[] | null {
    const ids = set.servers.map((s) => s.id)
    this.attached.push({ ids, input })
    return this.result === 'null' ? null : ids
  }
}

const BASE = { workspace: '/ws', jobId: 'job-1' }

describe('McpJobDelivery.prepare — bất biến `null` (G9)', () => {
  test('🚫 `ids` (mọi kiểu sai) VÀ 🚫 extras ⇒ null, 🚫 gọi `attach`, 🚫 cảnh báo', async () => {
    seed('on1')
    const delivery = new RecordingDelivery()
    const warnings: string[] = []

    for (const ids of [undefined, null, [], 'on1', {}, [1, true, null]]) {
      expect(await delivery.prepare({ ...BASE, ids, onWarning: (m) => warnings.push(m) })).toBeNull()
    }

    expect(delivery.attached).toEqual([])
    expect(warnings).toEqual([])
  })

  test('mọi id rụng (🚫 tồn tại / tắt) ⇒ null, 🚫 gọi `attach`, nhưng VẪN cảnh báo từng id', async () => {
    seed('off', false)
    const delivery = new RecordingDelivery()
    const warnings: string[] = []

    expect(await delivery.prepare({ ...BASE, ids: ['off', 'ghost'], onWarning: (m) => warnings.push(m) })).toBeNull()

    expect(delivery.attached).toEqual([])
    expect(warnings).toEqual([
      'mcp off: không tìm thấy hoặc đang tắt — job chạy không có server này',
      'mcp ghost: không tìm thấy hoặc đang tắt — job chạy không có server này',
    ])
  })

  test('`attach` trả null ⇒ `prepare` trả null', async () => {
    seed('on1')
    const delivery = new RecordingDelivery([], 'null')

    expect(await delivery.prepare({ ...BASE, ids: ['on1'] })).toBeNull()
    expect(delivery.attached).toHaveLength(1)
  })
})

describe('McpJobDelivery.prepare — trình tự', () => {
  test('server người dùng TRƯỚC, entry tự gắn SAU; `attach` nhận nguyên input', async () => {
    seed('on1')
    seed('on2')
    const delivery = new RecordingDelivery([stdio('self')])
    const input = { ...BASE, ids: ['on2', 'on1'], metadata: { x: 1 } }

    const handle = await delivery.prepare(input)

    // Thứ tự server người dùng theo store, entry tự gắn luôn đứng cuối (ghi sau ⇒ thắng khi trùng khoá).
    expect(handle).toEqual(['on1', 'on2', 'self'])
    expect(delivery.attached).toHaveLength(1)
    expect(delivery.attached[0].input).toBe(input)
  })

  test('chỉ có entry tự gắn (🚫 `ids`) ⇒ VẪN gọi `attach`', async () => {
    const delivery = new RecordingDelivery([stdio('self')])

    expect(await delivery.prepare({ ...BASE, ids: undefined })).toEqual(['self'])
  })

  test('mặc định: 🚫 `acceptsSelfServer`, `cleanupOrphans` là no-op 🚫 ném', () => {
    const delivery = new RecordingDelivery()
    expect(delivery.acceptsSelfServer).toBe(false)
    expect(() => delivery.cleanupOrphans()).not.toThrow()
  })
})

describe('NoMcpDelivery — Null Object (codex)', () => {
  test('kind `unsupported`, 🚫 nhận entry tự gắn', () => {
    const delivery = new NoMcpDelivery()
    expect(delivery.kind).toBe('unsupported')
    expect(delivery.acceptsSelfServer).toBe(false)
  })

  test('có `ids` hợp lệ lẫn id rụng ⇒ null, 🚫 cảnh báo, 🚫 đọc registry, 🚫 chạm đĩa', async () => {
    seed('on1')
    const before = fs.readdirSync(home).sort()
    const warnings: string[] = []

    // Gọi qua kiểu abstraction — đúng cách provider gọi (`mcpDelivery.prepare(input)`).
    const delivery: McpJobDelivery<unknown> = new NoMcpDelivery()
    const handle = await delivery.prepare({
      ...BASE,
      ids: ['on1', 'ghost'],
      onWarning: (m) => warnings.push(m),
    })

    expect(handle).toBeNull()
    // Hành vi codex trước refactor: 🚫 bao giờ đọc `mcpServers` ⇒ 🚫 một dòng cảnh báo nào.
    expect(warnings).toEqual([])
    expect(fs.readdirSync(home).sort()).toEqual(before)
    expect(fs.existsSync(path.join(home, 'mcp-runtime'))).toBe(false)
  })

  test('`cleanupOrphans` 🚫 ném', () => {
    expect(() => new NoMcpDelivery().cleanupOrphans()).not.toThrow()
  })
})
