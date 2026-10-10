// Tcebe274e-P3 · cổng đăng ký credential (design #468 §4.2.6).
//
// `mcp` 🚫 import `runner`: `runner/business/registry.ts` đăng ký adapter
// `RunnerCredentialResolver` lúc nạp module, caller không nhận resolver qua tham
// số (`mcp/controller.ts`) lấy lại bằng `credentialResolver()`.
//
// "Đã đăng ký hay chưa" là trạng thái của CẢ TIẾN TRÌNH, mà `bun test` nạp mọi
// file test chung một module registry — test khác nạp `runner` là trạng thái đổi.
// Vì vậy hai ca đăng ký / chưa đăng ký chạy trong tiến trình `bun` RIÊNG, đúng
// như hai loại tiến trình thật: dashboard (nạp `runner`) và stdio `mcp/stdio.ts`
// (chỉ nạp `mcp`).
import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  credentialResolver,
  useCredentialResolver,
  type CredentialResolver,
} from '../../../../../src/features/mcp/business/index.js'
import { RemoteMcpServer } from '../../../../../src/features/mcp/business/RemoteMcpServer.js'

const REPO_ROOT = path.resolve(import.meta.dir, '../../../../..')
const MCP_BARREL = path.join(REPO_ROOT, 'src/features/mcp/business/index.ts')
const RUNNER_BARREL = path.join(REPO_ROOT, 'src/features/runner/business/index.ts')
const RUNNER_ADAPTER = path.join(REPO_ROOT, 'src/features/runner/business/RunnerCredentialResolver.ts')

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** Chạy `body` trong một tiến trình `bun` mới, home tạm; trả JSON nó in ra stdout. */
function runFresh(body: string, env: Record<string, string> = {}): any {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-cred-port-'))
  tmpDirs.push(dir)
  const script = path.join(dir, 'probe.mjs')
  const url = (p: string) => JSON.stringify(pathToFileURL(p).href)
  fs.writeFileSync(
    script,
    body
      .replaceAll('__MCP__', url(MCP_BARREL))
      .replaceAll('__RUNNER__', url(RUNNER_BARREL))
      .replaceAll('__ADAPTER__', url(RUNNER_ADAPTER))
      // Barrel `runner` mở job queue / poller nên giữ event loop sống — thoát tường
      // minh sau khi in kết quả, 🚫 chờ tiến trình tự thoát.
      + ';process.exit(0);',
    'utf8',
  )
  const run = spawnSync(process.execPath, [script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, DEV_TEAM_DASHBOARD_HOME: path.join(dir, 'home'), ...env },
  })
  expect(run.status).toBe(0)
  const last = run.stdout.trim().split('\n').pop() ?? ''
  return JSON.parse(last)
}

describe('tiến trình chỉ nạp `mcp` (stdio `mcp/stdio.ts`, test riêng của mcp)', () => {
  test('chưa ai đăng ký ⇒ `credentialResolver()` là `null`', () => {
    const out = runFresh(`
      const mcp = await import(__MCP__)
      process.stdout.write(JSON.stringify({ isNull: mcp.credentialResolver() === null }))
    `)
    expect(out.isNull).toBe(true)
  }, 60_000)

  test('`null` ⇒ server từ xa bỏ header xác thực, kèm cảnh báo nguyên văn — 🚫 ném', () => {
    const out = runFresh(`
      const mcp = await import(__MCP__)
      const server = mcp.McpRegistry.normalise({ id: 'r', transport: 'http', url: 'https://example.com/mcp', credentialId: 'c1' })
      const resolved = server.resolve({ credentials: mcp.credentialResolver() })
      process.stdout.write(JSON.stringify(resolved))
    `)
    expect(out.secret).toBeNull()
    expect(out.values).toEqual({})
    expect(out.warnings).toEqual(['credential c1: không giải được secret — bỏ header xác thực'])
  }, 60_000)
})

describe('tiến trình nạp `runner` (dashboard)', () => {
  test('nạp barrel `runner` ⇒ adapter `RunnerCredentialResolver` đã đăng ký', () => {
    const out = runFresh(`
      await import(__RUNNER__)
      const mcp = await import(__MCP__)
      const { RunnerCredentialResolver } = await import(__ADAPTER__)
      process.stdout.write(JSON.stringify({ isAdapter: mcp.credentialResolver() instanceof RunnerCredentialResolver }))
    `)
    expect(out.isAdapter).toBe(true)
  }, 60_000)

  test('adapter đã đăng ký giải đúng credential của kho runner', () => {
    const out = runFresh(
      `
      const runner = await import(__RUNNER__)
      const mcp = await import(__MCP__)
      runner.upsertCredential({ id: 'c-env', provider: 'openai-api', secretRef: 'env:P3_CRED_PORT_TOKEN' })
      runner.upsertCredential({ id: 'c-cli', provider: 'claude-code-cli', secretRef: 'cli-session' })
      const r = mcp.credentialResolver()
      process.stdout.write(JSON.stringify({
        env: r.secretFor('c-env'),
        cli: r.secretFor('c-cli'),
        missing: r.secretFor('ghost'),
      }))
    `,
      { P3_CRED_PORT_TOKEN: 'tok-from-env-0123' },
    )
    // `cli-session` không phải secret trực tiếp ⇒ `null`, như adapter của P2.
    expect(out).toEqual({ env: 'tok-from-env-0123', cli: null, missing: null })
  }, 60_000)
})

describe('`useCredentialResolver` — trong cùng tiến trình', () => {
  test('bản đăng ký sau thay bản trước; `credentialResolver()` trả đúng instance', () => {
    const previous = credentialResolver()
    const first: CredentialResolver = { secretFor: () => 'first' }
    const second: CredentialResolver = { secretFor: (id) => (id === 'c1' ? 'second-secret' : null) }
    try {
      useCredentialResolver(first)
      expect(credentialResolver()).toBe(first)
      useCredentialResolver(second)
      expect(credentialResolver()).toBe(second)

      const server = new RemoteMcpServer({
        id: 'r',
        label: 'r',
        enabled: true,
        lastCheck: null,
        transport: 'http',
        url: 'https://example.com/mcp',
        credentialId: 'c1',
        headers: {},
      })
      const resolved = server.resolve({ credentials: credentialResolver() })
      expect(resolved.values).toEqual({ Authorization: 'Bearer second-secret' })
      expect(resolved.warnings).toEqual([])
    } finally {
      // Trả lại trạng thái tiến trình cho file test khác.
      if (previous) useCredentialResolver(previous)
      else useCredentialResolver({ secretFor: () => null })
    }
  })
})
