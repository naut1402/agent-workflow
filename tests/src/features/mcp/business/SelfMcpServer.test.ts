// Tcebe274e-P3 · `SelfMcpServer` (design #468 §4.2.7) — hợp đồng xuyên process
// giữa dashboard (ghi entry tự gắn, bơm env cho CLI) và tiến trình `mcp/stdio.ts`.
//
// Ba bất biến được chốt ở đây:
//   1. Hằng hợp đồng giữ ĐÚNG giá trị cũ — đổi một ký tự là CLI đã cấu hình sẵn
//      trên máy người dùng (`~/.claude.json`, `DEVTEAM_MCP_MODE=full`) hỏng im lặng.
//   2. `childEnv` và `forJob` dùng CHUNG một guard: không bao giờ có job mang
//      tool `orchestrator_decide` mà thiếu token của nó.
//   3. Entry giữ env TỐI THIỂU, `command = process.execPath`, `args = [entry, '--mode=full']`.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { DashboardMcpServer } from '../../../../../mcp/DashboardMcpServer'
import { SelfMcpServer } from '../../../../../src/features/mcp/business/index.js'
import { StdioMcpServer } from '../../../../../src/features/mcp/business/StdioMcpServer.js'

const REPO_ROOT = path.resolve(import.meta.dir, '../../../../..')
const BASE_URL = 'http://127.0.0.1:54321'
const TOKEN = 'orch-token-0123456789'

const ISOLATED = ['DEV_TEAM_SELF_BASE_URL'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ISOLATED) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})
afterEach(() => {
  for (const key of ISOLATED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

/** Job điều phối đi tuyến `mcp`, đủ mọi điều kiện. */
function orchestratorJob(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { orchestratorJob: true, orchestratorMcpRoute: 'mcp', orchestratorToken: TOKEN, ...over }
}

describe('hằng hợp đồng xuyên process', () => {
  test('giá trị giữ nguyên như trước refactor', () => {
    expect(SelfMcpServer.SERVER_ID).toBe('dev-team-dashboard')
    expect(SelfMcpServer.MODE_ENV_VAR).toBe('DEVTEAM_MCP_MODE')
    expect(SelfMcpServer.MODE_FULL_ARG).toBe('--mode=full')
    expect(SelfMcpServer.TOKEN_ENV).toBe('DASHBOARD_ORCHESTRATOR_TOKEN')
    expect(SelfMcpServer.BASE_URL_ENV).toBe('DASHBOARD_ORCHESTRATOR_BASE_URL')
  })

  test('đầu bên kia (`DashboardMcpServer`) đọc đúng các hằng đó', () => {
    expect(DashboardMcpServer.SERVER_NAME).toBe(SelfMcpServer.SERVER_ID)
    expect(DashboardMcpServer.MODE_ENV_VAR).toBe(SelfMcpServer.MODE_ENV_VAR)
  })

  test('`MODE_FULL_ARG` được chính `resolveMode` của tiến trình stdio hiểu là `full`', () => {
    expect(DashboardMcpServer.resolveMode({ argv: [SelfMcpServer.MODE_FULL_ARG], env: {}, warn: () => {} })).toBe('full')
  })
})

describe('childEnv — env bơm cho CLI của job', () => {
  test('job điều phối có token + dashboard biết base URL ⇒ đúng hai biến', () => {
    process.env.DEV_TEAM_SELF_BASE_URL = BASE_URL
    expect(SelfMcpServer.childEnv(orchestratorJob())).toEqual({
      DASHBOARD_ORCHESTRATOR_TOKEN: TOKEN,
      DASHBOARD_ORCHESTRATOR_BASE_URL: BASE_URL,
    })
  })

  test('guard KHÔNG đòi tuyến `mcp` — tuyến sentinel vẫn cần token cho `curl`', () => {
    process.env.DEV_TEAM_SELF_BASE_URL = BASE_URL
    expect(Object.keys(SelfMcpServer.childEnv(orchestratorJob({ orchestratorMcpRoute: 'sentinel' })))).toHaveLength(2)
    expect(Object.keys(SelfMcpServer.childEnv(orchestratorJob({ orchestratorMcpRoute: undefined })))).toHaveLength(2)
  })

  test.each([
    ['không phải job điều phối', { orchestratorJob: false }],
    ['orchestratorJob là chuỗi "true", không phải boolean', { orchestratorJob: 'true' }],
    ['thiếu token', { orchestratorToken: undefined }],
    ['token không phải chuỗi', { orchestratorToken: 42 }],
  ])('%s ⇒ `{}`', (_label, over) => {
    process.env.DEV_TEAM_SELF_BASE_URL = BASE_URL
    expect(SelfMcpServer.childEnv(orchestratorJob(over))).toEqual({})
  })

  test('dashboard chưa biết base URL của chính nó ⇒ `{}`', () => {
    expect(SelfMcpServer.childEnv(orchestratorJob())).toEqual({})
    process.env.DEV_TEAM_SELF_BASE_URL = ''
    expect(SelfMcpServer.childEnv(orchestratorJob())).toEqual({})
  })

  test('không có metadata ⇒ `{}`, 🚫 không ném', () => {
    process.env.DEV_TEAM_SELF_BASE_URL = BASE_URL
    expect(SelfMcpServer.childEnv()).toEqual({})
    expect(SelfMcpServer.childEnv(undefined)).toEqual({})
  })
})

describe('forJob — entry tự gắn cho job điều phối', () => {
  test('đủ điều kiện ⇒ entry stdio trỏ vào chính dashboard, env tối thiểu', () => {
    process.env.DEV_TEAM_SELF_BASE_URL = BASE_URL
    const server = SelfMcpServer.forJob(orchestratorJob())
    expect(server).toBeInstanceOf(SelfMcpServer)
    expect(server).toBeInstanceOf(StdioMcpServer)
    const config = server!.config
    expect(config.id).toBe('dev-team-dashboard')
    expect(config.label).toBe('dev-team-dashboard (self)')
    expect(config.enabled).toBe(true)
    expect(config.transport).toBe('stdio')
    // Chính runtime đang chạy dashboard, 🚫 chuỗi 'bun' (PATH của job có thể khác).
    expect(config.command).toBe(process.execPath)
    expect(config.args).toEqual([path.join(REPO_ROOT, 'mcp', 'stdio.ts'), '--mode=full'])
    // Thứ tự khoá cũng là hợp đồng: file `--mcp-config` ghi theo thứ tự này.
    expect(Object.entries(config.env ?? {})).toEqual([
      ['DEVTEAM_MCP_MODE', 'full'],
      ['DASHBOARD_ORCHESTRATOR_TOKEN', TOKEN],
      ['DASHBOARD_ORCHESTRATOR_BASE_URL', BASE_URL],
    ])
    expect(config.timeoutMs).toBeUndefined()
    expect(config.cwd).toBeUndefined()
  })

  test('tuyến khác `mcp` ⇒ `null`', () => {
    process.env.DEV_TEAM_SELF_BASE_URL = BASE_URL
    for (const route of ['sentinel', undefined, 'MCP', '']) {
      expect(SelfMcpServer.forJob(orchestratorJob({ orchestratorMcpRoute: route }))).toBeNull()
    }
  })

  test('mọi tổ hợp metadata: có entry ⇒ CHẮC CHẮN có env điều phối (guard chung)', () => {
    const jobs = [true, false, 'true', undefined]
    const routes = ['mcp', 'sentinel', undefined]
    const tokens = [TOKEN, '', undefined, 7]
    const baseUrls = [BASE_URL, '', undefined]
    let entries = 0
    for (const orchestratorJob of jobs)
      for (const orchestratorMcpRoute of routes)
        for (const orchestratorToken of tokens)
          for (const baseUrl of baseUrls) {
            if (baseUrl === undefined) delete process.env.DEV_TEAM_SELF_BASE_URL
            else process.env.DEV_TEAM_SELF_BASE_URL = baseUrl
            const metadata = { orchestratorJob, orchestratorMcpRoute, orchestratorToken }
            const server = SelfMcpServer.forJob(metadata)
            const env = SelfMcpServer.childEnv(metadata)
            if (server) {
              entries++
              expect(env).toEqual({
                DASHBOARD_ORCHESTRATOR_TOKEN: server.config.env!.DASHBOARD_ORCHESTRATOR_TOKEN,
                DASHBOARD_ORCHESTRATOR_BASE_URL: server.config.env!.DASHBOARD_ORCHESTRATOR_BASE_URL,
              })
            }
            // Chiều ngược lại: tuyến `mcp` + env đủ ⇒ phải có entry (repo có `mcp/stdio.ts`).
            if (orchestratorMcpRoute === 'mcp' && Object.keys(env).length) expect(server).not.toBeNull()
          }
    // Chống xanh giả: ít nhất một tổ hợp thật sự ra entry.
    expect(entries).toBeGreaterThan(0)
  })

  test('`toCliEntry` — entry trong file cấu hình giữ đúng bốn khoá, token nằm trong danh sách mask, `full` thì không', () => {
    process.env.DEV_TEAM_SELF_BASE_URL = BASE_URL
    const server = SelfMcpServer.forJob(orchestratorJob())!
    const cli = server.toCliEntry({ workspace: REPO_ROOT })
    expect(cli.entry).toEqual({
      type: 'stdio',
      command: process.execPath,
      args: [path.join(REPO_ROOT, 'mcp', 'stdio.ts'), '--mode=full'],
      env: {
        DEVTEAM_MCP_MODE: 'full',
        DASHBOARD_ORCHESTRATOR_TOKEN: TOKEN,
        DASHBOARD_ORCHESTRATOR_BASE_URL: BASE_URL,
      },
    })
    expect(cli.secrets).toContain(TOKEN)
    // 4 ký tự ⇒ dưới ngưỡng mask: mask nó là nuốt mất chữ `full` ở mọi dòng log.
    expect(cli.secrets).not.toContain('full')
    expect(cli.warnings).toEqual([])
  })

  test('`withLastCheck` giữ nguyên lớp `SelfMcpServer` (rebuild không rơi về `StdioMcpServer`)', () => {
    process.env.DEV_TEAM_SELF_BASE_URL = BASE_URL
    const server = SelfMcpServer.forJob(orchestratorJob())!
    const next = server.withLastCheck({ at: '2026-10-09T00:00:00.000Z', ok: true, toolCount: 1, toolNames: ['x'] })
    expect(next).toBeInstanceOf(SelfMcpServer)
    expect(next.config.args).toEqual(server.config.args)
  })
})

describe('canAttach', () => {
  test('repo có `mcp/stdio.ts` ⇒ true, và đó chính là entrypoint `forJob` khai', () => {
    process.env.DEV_TEAM_SELF_BASE_URL = BASE_URL
    expect(SelfMcpServer.canAttach()).toBe(true)
    const entry = SelfMcpServer.forJob(orchestratorJob())!.config.args![0]
    expect(fs.existsSync(entry)).toBe(true)
    expect(entry).toBe(path.join(REPO_ROOT, 'mcp', 'stdio.ts'))
  })
})
