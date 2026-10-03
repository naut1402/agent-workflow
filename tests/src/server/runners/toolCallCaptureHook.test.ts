// Tbefa5f4c · Nhóm H (TC-H01 … TC-H06) — móc `captureJobToolCalls` trong `jobQueue` (F8).
//
// Khác `captureJobUsage` ở đúng một điểm và đó là điểm dễ hồi quy nhất: móc này
// 🚫 KHÔNG giới hạn theo `claude-code-cli`, vì 131 job đo được chạy trên provider
// khác và job từ khung chat nằm hết ở đó.
//
// Rủi ro chính của một móc fire-and-forget là làm hỏng job đang chạy — TC-H04
// gác đúng chuyện đó.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  cancelJob,
  loadJob,
  registerProvider,
  submitJob,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import {
  resetLogDriver,
  setLogDriver,
  type LogEntry,
  type ToolCallLogEntry,
} from '../../../../src/backend/log/index.js'
import { invalidateLoggingPrefsCache } from '../../../../src/backend/log/loggingPrefsIo.js'
import { registryHome } from '../../../../src/backend/registry.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

const PROVIDER_ID = 'stub-toolcall-provider'
const SESSION = '33333333-3333-4333-8333-333333333333'

let home: string
const savedEnv = { ...process.env }
let written: LogEntry[] = []

/** Điều khiển hành vi của stub cho từng ca. */
let nextSessionId: string | null = SESSION
let blockUntilAbort = false
let nextTokenUsage: ExecuteResult['tokenUsage']

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  family: 'ai-api',
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 4 }),
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    if (blockUntilAbort) {
      await new Promise<void>((resolve) => {
        if (req.signal?.aborted) return resolve()
        req.signal?.addEventListener('abort', () => resolve())
      })
    }
    return {
      ok: true,
      exitCode: 0,
      durationMs: 1,
      sessionId: nextSessionId,
      ...(nextTokenUsage ? { tokenUsage: nextTokenUsage } : {}),
    }
  },
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function settle(id: string) {
  for (let i = 0; i < 400; i++) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled (status=${loadJob(id)?.status})`)
}

/** Móc chạy fire-and-forget sau khi job settle — chờ nó xuống driver. */
async function waitForEntries(type: LogEntry['type'], n: number, ms = 1500): Promise<LogEntry[]> {
  const deadline = Date.now() + ms
  for (;;) {
    const found = written.filter((e) => e.type === type)
    if (found.length >= n || Date.now() > deadline) return found
    await sleep(10)
  }
}

function writeSettings(): void {
  fs.writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify({
      logging: {
        showLogsTab: true,
        types: { audit: true, request: true, jobs: true, usage: true, 'tool-call': true },
      },
    }),
  )
  invalidateLoggingPrefsCache()
}

function writeSdkSession(sessionId: string, commands: string[]): void {
  const dir = path.join(registryHome(), 'agent-sdk-sessions')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${sessionId}.json`),
    JSON.stringify({
      sessionId,
      messages: commands.map((command) => ({
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Bash', input: { command } }],
      })),
    }),
  )
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-toolcall-hook-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-tc', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-tc', connectionId: 'stub-conn-tc', config: {} })
})

afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  nextSessionId = SESSION
  blockUntilAbort = false
  nextTokenUsage = undefined
  written = []
  fs.rmSync(path.join(home, 'agent-sdk-sessions'), { recursive: true, force: true })
  writeSettings()
  setLogDriver({
    kind: 'file',
    append: async (entry) => {
      written.push(entry)
    },
  })
})

afterEach(() => {
  resetLogDriver()
  invalidateLoggingPrefsCache()
})

const toolCallEntries = () =>
  written.filter((e) => e.type === 'tool-call') as ToolCallLogEntry[]

describe('Nhóm H — móc tool-call trong jobQueue', () => {
  test('TC-H01 + TC-H03: job kết thúc có sessionId → 1 entry, KỂ CẢ provider không phải claude-code-cli', async () => {
    writeSdkSession(SESSION, ['ls -la', 'grep -rn foo src'])

    const job = submitJob({
      runnerId: 'stub-runner-tc',
      agentRef: '',
      workspace: home,
      userPrompt: 'work',
      metadata: { taskId: 'T-H01', projectId: 'p-H01' },
    })
    const finished = await settle(job.id)
    expect(finished.status).toBe('succeeded')

    await waitForEntries('tool-call', 1)
    const entries = toolCallEntries().filter((e) => e.jobId === job.id)
    expect(entries).toHaveLength(1)
    // Provider ở đây là `stub-toolcall-provider`, KHÔNG phải claude-code-cli.
    expect(entries[0].provider).toBe(PROVIDER_ID)
    expect(entries[0].source).toBe('agent-sdk-session')
    expect(entries[0].calls).toHaveLength(2)
  })

  test('TC-H02: ⚠️ job bị huỷ VẪN ingest — lượt tool đã tiêu phải được đếm', async () => {
    writeSdkSession(SESSION, ['cat request.md'])
    blockUntilAbort = true

    const job = submitJob({
      runnerId: 'stub-runner-tc',
      agentRef: '',
      workspace: home,
      userPrompt: 'work',
      metadata: { taskId: 'T-H02', projectId: 'p-H02' },
    })
    for (let i = 0; i < 200 && loadJob(job.id)?.status !== 'running'; i++) await sleep(5)
    expect(cancelJob(job.id).ok).toBe(true)

    const finished = await settle(job.id)
    expect(finished.status).toBe('cancelled')

    await waitForEntries('tool-call', 1)
    expect(toolCallEntries().filter((e) => e.jobId === job.id)).toHaveLength(1)
  })

  test('TC-H04: ingest hỏng KHÔNG làm hỏng job, không có rejection chưa bắt', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)

    // Nguồn không đọc được: thư mục trùng tên file session → `readTextFile` ném.
    const dir = path.join(registryHome(), 'agent-sdk-sessions')
    fs.mkdirSync(path.join(dir, `${SESSION}.json`), { recursive: true })
    // Và driver log cũng ném — hai tầng lỗi cùng lúc.
    setLogDriver({
      kind: 'file',
      append: async () => {
        throw new Error('driver down')
      },
    })
    nextTokenUsage = {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    } as ExecuteResult['tokenUsage']

    try {
      const job = submitJob({
        runnerId: 'stub-runner-tc',
        agentRef: '',
        workspace: home,
        userPrompt: 'work',
        metadata: { taskId: 'T-H04', projectId: 'p-H04' },
      })
      const finished = await settle(job.id)
      expect(finished.status).toBe('succeeded')
      // Nhường vài nhịp cho mọi promise fire-and-forget settle.
      await sleep(200)
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  test('TC-H05: job không có sessionId → không gọi ingest, không entry', async () => {
    nextSessionId = null
    const job = submitJob({
      runnerId: 'stub-runner-tc',
      agentRef: '',
      workspace: home,
      userPrompt: 'work',
      metadata: { taskId: 'T-H05', projectId: 'p-H05' },
    })
    const finished = await settle(job.id)
    expect(finished.status).toBe('succeeded')

    await sleep(200)
    expect(toolCallEntries().filter((e) => e.jobId === job.id)).toHaveLength(0)
  })

  test('TC-H06: ⚠️ hồi quy usage — entry `usage` vẫn ghi đúng như trước', async () => {
    writeSdkSession(SESSION, ['ls -la'])
    nextTokenUsage = {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    } as ExecuteResult['tokenUsage']

    const job = submitJob({
      runnerId: 'stub-runner-tc',
      agentRef: '',
      workspace: home,
      userPrompt: 'work',
      metadata: { taskId: 'T-H06', projectId: 'p-H06' },
    })
    await settle(job.id)

    await waitForEntries('usage', 1)
    await waitForEntries('tool-call', 1)
    const usage = written.filter((e) => e.type === 'usage' && (e as any).jobId === job.id)
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ inputTokens: 10, outputTokens: 5 })
    // Và móc mới vẫn ghi entry của mình — hai đường độc lập.
    expect(toolCallEntries().filter((e) => e.jobId === job.id)).toHaveLength(1)
  })
})
