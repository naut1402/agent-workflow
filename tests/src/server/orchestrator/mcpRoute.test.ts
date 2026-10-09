// Tf2f484e2 · TC-B01 … TC-B08 — chốt tuyến ra lệnh ở RUNTIME.
//
// Bề mặt quan sát: giá trị tuyến (`'mcp'` / `'sentinel'`) mà dashboard chốt cho
// một lượt điều phối, tính từ trạng thái môi trường + registry runner/connection.
// Mỗi ca dựng trạng thái rồi đọc kết quả — 🚫 không ca nào bám vào tên biến nội
// bộ của `resolveDecisionRoute`.
//
// ⚠️ AC3 của `request.md`: "việc chọn đường điều phối phải quyết định ở runtime
// theo trạng thái kết nối MCP". TC-B01 vs TC-B02…B07 là phép chứng minh: cùng
// một build, đổi trạng thái thì kết quả đổi theo ⇒ 🚫 không phải hằng số.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveDecisionRoute } from '../../../../src/features/orchestrator/business/mcpRoute.js'
import {
  canAttachSelfMcp,
  setDefaultRunner,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'

const SELF_BASE_URL = 'http://127.0.0.1:54999'
const REPO_ROOT = path.resolve(import.meta.dir, '../../../..')

let home: string
const savedEnv = { ...process.env }

/** `registryHome()` CHÍNH LÀ giá trị này — `runners.json` nằm ngay dưới đây. */
function runnersFile(): string {
  return path.join(home, 'runners.json')
}

/** Runner mặc định trỏ tới một connection dùng `providerId` cho trước. */
function seedDefaultRunner(providerId: string, opts: { connectionId?: string } = {}) {
  const connId = opts.connectionId ?? `conn-${providerId}`
  upsertConnection({ id: connId, kind: 'local-console', providerId, cliPath: 'stub' })
  upsertRunner({ id: 'r-default', connectionId: connId, config: {} })
  setDefaultRunner('r-default')
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcproute-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.DEV_TEAM_SELF_BASE_URL = SELF_BASE_URL
})

afterEach(() => {
  process.env = { ...savedEnv }
  fs.rmSync(home, { recursive: true, force: true })
})

describe('resolveDecisionRoute — tuyến `mcp`', () => {
  // TC-B01
  test('TC-B01: đủ điều kiện ⇒ mcp', () => {
    seedDefaultRunner('claude-code-cli')
    const res = resolveDecisionRoute()
    expect(res.route).toBe('mcp')
    expect(typeof res.reason).toBe('string')
    expect(res.reason.length).toBeGreaterThan(0)
  })

  // AC3 — cùng một build, đổi trạng thái thì kết quả ĐỔI THEO. Không có ca này
  // thì "quyết định ở runtime" không được chứng minh bằng gì.
  test('TC-B01 (AC3): cùng tiến trình, gỡ điều kiện ⇒ kết quả đổi ngay', () => {
    seedDefaultRunner('claude-code-cli')
    expect(resolveDecisionRoute().route).toBe('mcp')

    delete process.env.DEV_TEAM_SELF_BASE_URL
    expect(resolveDecisionRoute().route).toBe('sentinel')

    process.env.DEV_TEAM_SELF_BASE_URL = SELF_BASE_URL
    expect(resolveDecisionRoute().route).toBe('mcp')
  })
})

describe('resolveDecisionRoute — mọi nhánh thiếu điều kiện rơi về `sentinel`', () => {
  // TC-B02
  test('TC-B02: dashboard chưa biết base URL của chính nó ⇒ sentinel', () => {
    seedDefaultRunner('claude-code-cli')
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env.DEV_TEAM_SELF_BASE_URL
      else process.env.DEV_TEAM_SELF_BASE_URL = value
      expect(resolveDecisionRoute().route).toBe('sentinel')
    }
  })

  // TC-B03
  test('TC-B03: không có default runner ⇒ sentinel, 🚫 không ném', () => {
    expect(resolveDecisionRoute().route).toBe('sentinel')
  })

  // TC-B04 — runner mặc định trỏ một `connectionId` đã bị xoá.
  test('TC-B04: connection của default runner không tồn tại ⇒ sentinel, 🚫 không ném', () => {
    upsertConnection({ id: 'conn-tam', kind: 'local-console', providerId: 'claude-code-cli', cliPath: 'stub' })
    upsertRunner({ id: 'r-default', connectionId: 'conn-tam', config: {} })
    setDefaultRunner('r-default')
    // Xoá thẳng connection khỏi store, giữ nguyên runner trỏ vào nó.
    fs.writeFileSync(
      path.join(home, 'connections.json'),
      JSON.stringify({ version: 1, connections: [] }, null, 2),
      'utf8',
    )
    expect(resolveDecisionRoute().route).toBe('sentinel')
  })

  // TC-B05
  test('TC-B05: provider không nhận file khai MCP ⇒ sentinel', () => {
    // `cursor-cli` / `codex-cli` / họ `ai-api` vẫn là runner AI hợp lệ (được chọn
    // làm mặc định) nhưng delivery của chúng 🚫 `acceptsSelfServer` — chỉ file
    // `--mcp-config` riêng theo job của claude mang được entry tự gắn.
    for (const providerId of ['cursor-cli', 'codex-cli', 'openai-api', 'anthropic-api']) {
      fs.rmSync(runnersFile(), { force: true })
      fs.rmSync(path.join(home, 'connections.json'), { force: true })
      seedDefaultRunner(providerId)
      const res = resolveDecisionRoute()
      expect(res.route, providerId).toBe('sentinel')
      // Đúng lý do — 🚫 rơi về sentinel vì một điều kiện khác (runner, base URL…).
      expect(res.reason, providerId).toBe(`provider ${providerId} không nhận --mcp-config`)
    }
  })

  // TC-B07
  test('TC-B07: registry hỏng JSON ⇒ sentinel, hàm KHÔNG ném', () => {
    seedDefaultRunner('claude-code-cli')
    fs.writeFileSync(runnersFile(), '{ dit la JSON hong', 'utf8')
    expect(() => resolveDecisionRoute()).not.toThrow()
    expect(resolveDecisionRoute().route).toBe('sentinel')
  })

  test('TC-B07 (b): registry là thư mục / không đọc được ⇒ sentinel, không ném', () => {
    seedDefaultRunner('claude-code-cli')
    fs.rmSync(runnersFile(), { force: true })
    fs.mkdirSync(runnersFile(), { recursive: true })
    expect(() => resolveDecisionRoute()).not.toThrow()
    expect(resolveDecisionRoute().route).toBe('sentinel')
  })
})

describe('TC-B08: chốt tuyến không có tác dụng phụ', () => {
  test('gọi 2 lần trên cùng trạng thái ⇒ cùng kết quả, 🚫 không ghi file, 🚫 không request', () => {
    seedDefaultRunner('claude-code-cli')
    const before = fs.readdirSync(home).sort()

    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response('{}')
    }) as unknown as typeof fetch
    try {
      const a = resolveDecisionRoute()
      const b = resolveDecisionRoute()
      expect(a).toEqual(b)
    } finally {
      globalThis.fetch = realFetch
    }

    expect(calls).toBe(0)
    expect(fs.readdirSync(home).sort()).toEqual(before)
  })
})

/**
 * TC-B06 — entrypoint MCP không có trên đĩa (bản đóng gói thiếu `mcp/`).
 *
 * `canAttachSelfMcp()` định vị `mcp/stdio.ts` tương đối với `import.meta.url`
 * của `selfMcpConfig.ts`, nên không mô phỏng được bằng env hay mock trong tiến
 * trình này (repo luôn có `mcp/`). Thay vào đó dựng một CÂY FILE tối thiểu
 * trong thư mục tạm — `selfMcpConfig.ts` chỉ phụ thuộc `fileHelper.ts` (toàn
 * node builtin) và một `import type` bị xoá lúc transpile — rồi chạy trong một
 * tiến trình `bun` riêng, một lượt CÓ `mcp/stdio.ts` và một lượt KHÔNG.
 *
 * Bất biến được chốt: 🚫 không bao giờ dạy agent gọi một tool chắc chắn không
 * tồn tại.
 */
describe('TC-B06: entrypoint MCP không có trên đĩa', () => {
  function stageTree(withEntrypoint: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-selfmcp-tree-'))
    const copy = (rel: string) => {
      const dest = path.join(dir, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(path.join(REPO_ROOT, rel), dest)
    }
    copy('src/features/runner/business/providers/selfMcpConfig.ts')
    copy('src/backend/lib/fileHelper.ts')
    copy('src/features/mcp/schemas/mcpServer.ts')
    if (withEntrypoint) copy('mcp/stdio.ts')
    return dir
  }

  function probe(dir: string): { canAttach: boolean; entry: unknown } {
    const script = path.join(dir, 'probe.mjs')
    fs.writeFileSync(
      script,
      [
        "import { canAttachSelfMcp, buildSelfMcpEntry } from './src/features/runner/business/providers/selfMcpConfig.ts'",
        "const entry = buildSelfMcpEntry({ orchestratorToken: 't', baseUrl: 'http://x' })",
        'process.stdout.write(JSON.stringify({ canAttach: canAttachSelfMcp(), entry }))',
      ].join('\n'),
      'utf8',
    )
    const run = spawnSync('bun', [script], { cwd: dir, encoding: 'utf8', timeout: 30_000 })
    expect(run.status).toBe(0)
    return JSON.parse(run.stdout)
  }

  test('thiếu `mcp/stdio.ts` ⇒ canAttachSelfMcp false và 🚫 không dựng được entry', () => {
    const withEntry = stageTree(true)
    const without = stageTree(false)
    try {
      // Đối chứng: cùng đoạn code, chỉ khác sự tồn tại của entrypoint.
      const good = probe(withEntry)
      expect(good.canAttach).toBe(true)
      expect(good.entry).toBeTruthy()

      const bad = probe(without)
      expect(bad.canAttach).toBe(false)
      expect(bad.entry).toBeNull()
    } finally {
      fs.rmSync(withEntry, { recursive: true, force: true })
      fs.rmSync(without, { recursive: true, force: true })
    }
  }, 60_000)

  test('trong repo này entrypoint CÓ thật — nhánh dương của TC-B01 không xanh giả', () => {
    expect(canAttachSelfMcp()).toBe(true)
    expect(fs.existsSync(path.join(REPO_ROOT, 'mcp', 'stdio.ts'))).toBe(true)
  })
})
