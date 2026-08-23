import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runAutomation } from '../../../../src/features/automations/business/runAction.js'
import { listRuns } from '../../../../src/features/automations/business/runLedger.js'
import type { AutomationRun, AutomationRuleRecord } from '../../../../src/features/automations/schemas/automation.js'
import { registerProvider, upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// executeSequence dispatch theo `action.kind` (#233 + httpRequest/runCommand
// task 202608_003) chưa có test nào trước đây — gap ghi nhận ở
// investigate.md §5, bắt buộc vì thêm 2 nhánh dispatch mới.

const PROVIDER_ID = 'stub-run-command-provider'

let lastExecuteRequest: ExecuteRequest | null = null
let stubResult: ExecuteResult = { ok: true, exitCode: 0, durationMs: 1 }

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  family: 'console-command',
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    lastExecuteRequest = req
    return stubResult
  },
}

let home: string
let root: string
const savedEnv = { ...process.env }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// `executeSequence` chờ job qua `waitJobTerminal` (poll mỗi 1.5s bên trong
// runAction.ts) — cho đủ thời gian để ít nhất một chu kỳ poll đó trôi qua.
async function waitForOutcome(runId: string, projectId: string | null): Promise<AutomationRun> {
  for (let i = 0; i < 100; i++) {
    const run = listRuns(projectId, 50).find((r) => r.runId === runId)
    if (run && run.outcome !== 'running') return run
    await sleep(100)
  }
  throw new Error(`run ${runId} never settled`)
}

function baseRule(overrides: Partial<AutomationRuleRecord>): AutomationRuleRecord {
  return {
    version: 1,
    id: 'rule-under-test',
    name: 'Rule under test',
    enabled: true,
    triggers: [{ id: 't1', kind: 'timer', startAt: '2099-01-01T00:00:00.000Z', repeat: { mode: 'once' } }],
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AutomationRuleRecord
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-automations-run-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-run-command-conn', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-run-command-runner', connectionId: 'stub-run-command-conn', config: {} })
})

afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-automations-root-'))
  lastExecuteRequest = null
  stubResult = { ok: true, exitCode: 0, durationMs: 1 }
})

describe('httpRequest action — bất biến chống SSRF (fetchUrlSafe)', () => {
  test('URL không phải https bị chặn — step failed, không có job', async () => {
    const rule = baseRule({
      id: 'http-non-https',
      actions: [{ kind: 'httpRequest', method: 'GET', url: 'http://example.com/hook' }],
    })
    const run = runAutomation({ root, projectId: 'p1', rule, source: 'manual' })
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('failed')
    expect(final.steps).toHaveLength(1)
    expect(final.steps![0].status).toBe('failed')
    expect(final.steps![0].error).toMatch(/https/i)
    expect(final.steps![0].jobId).toBeUndefined()
    expect(final.steps![0].taskId).toBeUndefined()
    expect(final.steps![0].input).toEqual({ method: 'GET', url: 'http://example.com/hook' })
  })

  test('URL https trỏ private host bị chặn — step failed', async () => {
    const rule = baseRule({
      id: 'http-private-host',
      actions: [{ kind: 'httpRequest', method: 'GET', url: 'https://127.0.0.1/metadata' }],
    })
    const run = runAutomation({ root, projectId: 'p1', rule, source: 'manual' })
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('failed')
    expect(final.steps![0].status).toBe('failed')
    expect(final.steps![0].error).toMatch(/private/i)
  })

  test('bước httpRequest fail dừng chuỗi — bước runCommand sau đó không chạy', async () => {
    const rule = baseRule({
      id: 'http-then-command',
      actions: [
        { kind: 'httpRequest', method: 'GET', url: 'http://example.com/hook' },
        { kind: 'runCommand', runnerId: 'stub-run-command-runner', params: 'echo should-not-run' },
      ],
    })
    const run = runAutomation({ root, projectId: 'p1', rule, source: 'manual' })
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('failed')
    expect(final.steps).toHaveLength(1)
    expect(lastExecuteRequest).toBeNull()
  })
})

describe('runCommand action', () => {
  test('submit job qua runner đã cấu hình, agentRef rỗng, workspace mới tạo dưới automations/<ruleId>/runs/<runId>/', async () => {
    const logFile = path.join(root, 'stub-stdout.log')
    fs.writeFileSync(logFile, 'hello from command\n')
    stubResult = { ok: true, exitCode: 0, durationMs: 1, logPath: logFile }

    const rule = baseRule({
      id: 'command-rule',
      actions: [{ kind: 'runCommand', runnerId: 'stub-run-command-runner', params: 'echo hello' }],
    })
    const run = runAutomation({ root, projectId: 'p1', rule, source: 'manual' })
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('succeeded')
    expect(final.steps).toHaveLength(1)
    expect(final.steps![0].status).toBe('succeeded')
    expect(final.steps![0].stdout).toBe('hello from command\n')
    expect(final.steps![0].taskId).toBeUndefined()
    expect(final.steps![0].input).toEqual({ runnerId: 'stub-run-command-runner', params: 'echo hello' })

    expect(lastExecuteRequest).not.toBeNull()
    expect(lastExecuteRequest!.resolvedAgent.ref).toBe('')
    expect(lastExecuteRequest!.userPrompt).toBe('echo hello')

    const runsDir = path.join(root, 'automations', 'command-rule', 'runs', run.runId)
    const entries = fs.readdirSync(runsDir)
    expect(entries.some((e) => e.startsWith('cmd-'))).toBe(true)
  })

  test('runner báo lỗi → step failed, outcome failed', async () => {
    stubResult = { ok: false, exitCode: 1, durationMs: 1, error: 'boom' }
    const rule = baseRule({
      id: 'command-rule-fail',
      actions: [{ kind: 'runCommand', runnerId: 'stub-run-command-runner', params: 'false' }],
    })
    const run = runAutomation({ root, projectId: 'p1', rule, source: 'manual' })
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('failed')
    expect(final.steps![0].status).toBe('failed')
  })
})

describe('runTask action (regression — dispatch không đổi)', () => {
  test('mode=existing với taskId không tồn tại vẫn fail đúng như trước khi thêm kind mới', async () => {
    const rule = baseRule({
      id: 'runtask-existing-missing',
      actions: [{ kind: 'runTask', mode: 'existing', taskId: 'Tmissing1' }],
    })
    const run = runAutomation({ root, projectId: 'p1', rule, source: 'manual' })
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('failed')
    expect(final.steps![0].taskId).toBe('Tmissing1')
    expect(final.steps![0].error).toBe('task not found')
    expect(final.steps![0].jobId).toBeUndefined()
    expect(final.steps![0].input).toEqual({ mode: 'existing', taskId: 'Tmissing1' })
  })
})
