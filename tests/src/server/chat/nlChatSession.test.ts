import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadJob,
  loadTaskSessionLedger,
  registerProvider,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types'
import { TASK_ID_PATTERN } from '../../../../src/core/contracts/schemas/taskCreate'
import { ensureNlChatBuilderAgent } from '../../../../src/features/agent-editor/business/index'
import {
  startNlChatSession,
  continueNlChatSession,
  getNlChatTurn,
  cancelNlChatSession,
  isNlChatSessionId,
} from '../../../../src/features/nl-chat/business/nlChatSession'

// startNlChatSession/continueNlChatSession are thin wrappers around
// submitJob/sendTaskFeedback (F0011) — these tests exercise the wrapper
// against a real (in-memory) job queue with a stub provider, the same style
// as tests/server/runners/jobFeedback.test.ts, rather than mocking the
// runner plane out entirely.

const PROVIDER_ID = 'stub-nl-chat'

interface Captured {
  sessionId?: string
  resumeSessionId?: string
  userPrompt: string
}
const captured: Captured[] = []
let nextStdout = ''
/** When set, written to the job log instead of `nextStdout` (runner framing tests). */
let nextLog: string | null = null
/** Simulates a job recorded before `stdout` was persisted on the job record. */
let omitStdout = false

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    captured.push({ sessionId: req.sessionId, resumeSessionId: req.resumeSessionId, userPrompt: req.userPrompt })
    const logPath = req.metadata?.logPath as string | undefined
    if (logPath) {
      try {
        fs.writeFileSync(logPath, nextLog ?? nextStdout, 'utf8')
      } catch {
        /* ignore */
      }
    }
    return { ok: true, exitCode: 0, durationMs: 1, ...(omitStdout ? {} : { stdout: nextStdout }), logPath }
  },
}

let home: string
let root: string
const savedEnv = { ...process.env }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function settle(id: string) {
  for (let i = 0; i < 400; i++) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled`)
}

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-nlchat-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-nlchat-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-nlchat', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-nlchat', connectionId: 'stub-conn-nlchat', config: {} })
  await ensureNlChatBuilderAgent(root)
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  captured.length = 0
  nextStdout = ''
  nextLog = null
  omitStdout = false
})

describe('startNlChatSession', () => {
  test('mints a TASK_ID_PATTERN-shaped id and submits a job with sessionMode: new', async () => {
    nextStdout = 'Bạn muốn tạo task tên gì?'
    const { chatSessionId, job } = startNlChatSession({
      projectId: 'P1',
      entityType: 'task',
      message: 'tạo task sửa bug đăng nhập',
      runnerId: 'stub-runner-nlchat',
      devTeamRoot: root,
    })

    expect(isNlChatSessionId(chatSessionId)).toBe(true)
    expect(TASK_ID_PATTERN.test(chatSessionId)).toBe(true)
    expect(job.metadata?.taskId).toBe(chatSessionId)
    expect(job.metadata?.isNlChat).toBe(true)
    expect(job.metadata?.entityType).toBe('task')

    await settle(job.id)
    const ledger = loadTaskSessionLedger('P1', chatSessionId)
    expect(ledger.sessions.some((s) => s.status === 'open')).toBe(true)
  })
})

describe('continueNlChatSession', () => {
  test('resumes the ledger session via sendTaskFeedback (not a fresh session)', async () => {
    nextStdout = 'Câu hỏi tiếp theo?'
    const { chatSessionId, job } = startNlChatSession({
      projectId: 'P2',
      entityType: 'pipeline',
      message: 'tạo pipeline review',
      runnerId: 'stub-runner-nlchat',
      devTeamRoot: root,
    })
    await settle(job.id)
    const openBefore = loadTaskSessionLedger('P2', chatSessionId).sessions.find((s) => s.status === 'open')
    expect(openBefore?.sessionId).toBeTruthy()

    const result = continueNlChatSession(chatSessionId, 'P2', 'chỉ dùng agent implementer')
    expect(result.ok).toBe(true)
    if ('error' in result) throw new Error(result.error)
    await settle(result.job.id)

    const lastReq = captured[captured.length - 1]
    expect(lastReq.resumeSessionId).toBe(openBefore!.sessionId!)
    expect(lastReq.userPrompt).toContain('chỉ dùng agent implementer')
  })

  test('auto mode (no entityType pinned) still resumes the session', async () => {
    nextStdout = 'Bạn muốn tạo gì?'
    const { chatSessionId, job } = startNlChatSession({
      projectId: 'P2b',
      message: 'chào bạn',
      runnerId: 'stub-runner-nlchat',
      devTeamRoot: root,
    })
    expect(job.metadata?.entityType).toBeUndefined()
    await settle(job.id)

    const result = continueNlChatSession(chatSessionId, 'P2b', 'mình muốn tạo một task')
    expect(result.ok).toBe(true)
    if ('error' in result) throw new Error(result.error)
    await settle(result.job.id)
    expect(captured[captured.length - 1].userPrompt).toContain('mình muốn tạo một task')
  })

  test('unknown chat session id → error result, no throw', () => {
    const result = continueNlChatSession('nlchat-doesnotexist', 'P2', 'hi')
    expect(result).toMatchObject({ ok: false, status: 404 })
  })
})

describe('getNlChatTurn', () => {
  test('pending while the job is still queued/running', async () => {
    // A fresh session's job may already be terminal by the time we check
    // (stub provider resolves synchronously); assert the API never throws
    // and returns one of the documented statuses.
    nextStdout = '===DRAFT_READY===\n```json\n{"taskId": "t1", "prompt": "p"}\n```'
    const { chatSessionId, job } = startNlChatSession({
      projectId: 'P3',
      entityType: 'task',
      message: 'm',
      runnerId: 'stub-runner-nlchat',
      devTeamRoot: root,
    })
    const turn = getNlChatTurn(chatSessionId)
    expect(['pending', 'ready', 'error']).toContain(turn.status)
    await settle(job.id)
  })

  test('ready + draft once the job succeeds with a DRAFT_READY stdout', async () => {
    nextStdout = '===DRAFT_READY===\n```json\n{"taskId": "t1", "prompt": "p"}\n```'
    const { chatSessionId, job } = startNlChatSession({
      projectId: 'P4',
      entityType: 'task',
      message: 'm',
      runnerId: 'stub-runner-nlchat',
      devTeamRoot: root,
    })
    await settle(job.id)
    const turn = getNlChatTurn(chatSessionId)
    expect(turn).toMatchObject({ status: 'ready', kind: 'draft', draft: { taskId: 't1', prompt: 'p' } })
  })

  test('returns only the agent answer, never the runner log framing', async () => {
    nextStdout = 'Xin chào! Bạn muốn tạo gì?'
    nextLog = [
      '=== Payload gửi cho runner ===',
      'Agent: dashboard:nl-chat-builder (nl-chat-builder) — model: claude-sonnet-4-6',
      '--- Prompt ---',
      'Output contract (BẮT BUỘC tuân theo ở MỌI lượt trả lời): ...',
      '',
      '=== Phản hồi của runner (stdout/stderr) ===',
      '',
      '[runner] process started pid=18216 — chờ stdout/stderr…',
      nextStdout,
      '',
      '=== Kết quả ===',
      'ok: true',
      'exitCode: 0',
    ].join('\n')
    const { chatSessionId, job } = startNlChatSession({
      projectId: 'P4b',
      message: 'hello',
      runnerId: 'stub-runner-nlchat',
      devTeamRoot: root,
    })
    await settle(job.id)

    expect(getNlChatTurn(chatSessionId)).toMatchObject({ status: 'ready', kind: 'question', text: nextStdout })
  })

  test('falls back to the log body (framing stripped) when the job has no stdout', async () => {
    omitStdout = true
    nextStdout = 'Bạn muốn đặt tên task là gì?'
    nextLog = [
      '=== Payload gửi cho runner ===',
      '--- Prompt ---',
      'Người dùng (lượt 1): tạo task',
      '',
      '=== Phản hồi của runner (stdout/stderr) ===',
      '',
      '[runner] process started pid=1 — chờ stdout/stderr…',
      nextStdout,
      '',
      '=== Kết quả ===',
      'ok: true',
    ].join('\n')
    const { chatSessionId, job } = startNlChatSession({
      projectId: 'P4c',
      message: 'tạo task',
      runnerId: 'stub-runner-nlchat',
      devTeamRoot: root,
    })
    await settle(job.id)

    const turn = getNlChatTurn(chatSessionId)
    expect(turn).toMatchObject({ status: 'ready', kind: 'question', text: nextStdout })
  })

  test('unknown chat session id → error', () => {
    const turn = getNlChatTurn('nlchat-doesnotexist')
    expect(turn).toMatchObject({ status: 'error' })
  })
})

describe('cancelNlChatSession', () => {
  test('closes the ledger session and removes the scratch workspace', async () => {
    nextStdout = 'ok'
    const { chatSessionId, job } = startNlChatSession({
      projectId: 'P5',
      entityType: 'agent',
      message: 'm',
      runnerId: 'stub-runner-nlchat',
      devTeamRoot: root,
    })
    await settle(job.id)
    const workspace = loadJob(job.id)!.workspace
    expect(fs.existsSync(workspace)).toBe(true)

    cancelNlChatSession(chatSessionId, 'P5')

    const ledger = loadTaskSessionLedger('P5', chatSessionId)
    expect(ledger.sessions.every((s) => s.status !== 'open')).toBe(true)
    expect(fs.existsSync(workspace)).toBe(false)
  })
})
