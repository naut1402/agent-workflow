import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodeWorkspacePath } from '../../../../src/features/monitor/business/sessionTranscript'
import { getTaskChatState, resolveChatSession } from '../../../../src/features/monitor/business/taskChat'
import { saveTaskSessionLedger, type SessionEntry } from '../../../../src/features/runner/business/sessionLedger'
import { upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index'
import type { JobRecord } from '../../../../src/features/runner/business/types'

// getTaskChatState mirrors sendTaskFeedback's guard order so the UI can explain
// why sending is blocked before the user types, and resolves WHICH CLI session
// to replay for a given (task, step).

const PROJECT = 'P-chat'
const TASK = 'DEMO-1'
const WORKSPACE = path.join('C:', 'work', 'tasks', 'DEMO-1')

let home: string
let configDir: string
const savedEnv = { ...process.env }

function writeJob(job: Partial<JobRecord> & { id: string }): void {
  const dir = path.join(home, 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  const full: JobRecord = {
    status: 'succeeded',
    runnerId: 'r1',
    agentRef: 'a1',
    workspace: WORKSPACE,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    exitCode: 0,
    metadata: { taskId: TASK, projectId: PROJECT },
    ...job,
  } as JobRecord
  fs.writeFileSync(path.join(dir, `${job.id}.json`), JSON.stringify(full), 'utf8')
}

function writeTranscript(sessionId: string, texts: string[]): void {
  const dir = path.join(configDir, 'projects', encodeWorkspacePath(WORKSPACE))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${sessionId}.jsonl`),
    texts
      .map((t) => `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } })}\n`)
      .join(''),
    'utf8',
  )
}

function ledgerEntry(over: Partial<SessionEntry> & { sessionId: string }): SessionEntry {
  return {
    providerId: 'claude-code-cli',
    runnerId: 'r1',
    connectionId: 'c1',
    workspace: WORKSPACE,
    host: os.hostname(),
    stepIds: [],
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-taskchat-home-'))
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-taskchat-cfg-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(() => {
  fs.rmSync(path.join(home, 'jobs'), { recursive: true, force: true })
  fs.rmSync(path.join(home, 'sessions'), { recursive: true, force: true })
})

afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(configDir, { recursive: true, force: true })
})

describe('resolveChatSession', () => {
  test('a running job wins — its session is the one producing output now', () => {
    writeJob({ id: 'j-old', sessionId: 's-old', createdAt: '2026-01-01T00:00:00.000Z' })
    writeJob({
      id: 'j-live',
      status: 'running',
      sessionId: 's-live',
      finishedAt: null,
      createdAt: '2026-01-02T00:00:00.000Z',
    })
    expect(resolveChatSession(PROJECT, TASK).sessionId).toBe('s-live')
  })

  test('prefers the requested step: pipelineStepId is honoured, not just stepId', () => {
    writeJob({
      id: 'j-design',
      sessionId: 's-design',
      createdAt: '2026-01-01T00:00:00.000Z',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'design' },
    })
    writeJob({
      id: 'j-impl',
      sessionId: 's-impl',
      createdAt: '2026-01-03T00:00:00.000Z',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'implement' },
    })
    expect(resolveChatSession(PROJECT, TASK, 'design').sessionId).toBe('s-design')
    // No step asked for → newest job's session.
    expect(resolveChatSession(PROJECT, TASK).sessionId).toBe('s-impl')
  })

  test('falls back to the ledger entry that recorded the step', () => {
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'per-step',
      sessions: [
        ledgerEntry({ sessionId: 's-review', stepIds: ['review'], status: 'closed' }),
        ledgerEntry({ sessionId: 's-newest' }),
      ],
    })
    expect(resolveChatSession(PROJECT, TASK, 'review').sessionId).toBe('s-review')
    expect(resolveChatSession(PROJECT, TASK).sessionId).toBe('s-newest')
  })

  test('nothing recorded anywhere → null session', () => {
    expect(resolveChatSession(PROJECT, TASK).sessionId).toBeNull()
  })

  test('reports a stale ledger entry so the UI can warn about lost context', () => {
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [ledgerEntry({ sessionId: 's-stale', status: 'stale', staleReason: 'host changed' })],
    })
    expect(resolveChatSession(PROJECT, TASK)).toMatchObject({ sessionId: 's-stale', staleReason: 'host changed' })
  })
})

describe('getTaskChatState', () => {
  test('replays the resolved session transcript and reports the next cursor', () => {
    writeJob({ id: 'j1', sessionId: 's1' })
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [ledgerEntry({ sessionId: 's1' })],
    })
    writeTranscript('s1', ['một', 'hai'])

    const state = getTaskChatState(PROJECT, TASK)
    expect(state.transcriptFound).toBe(true)
    expect(state.turns.map((t) => t.text)).toEqual(['một', 'hai'])
    expect(state.total).toBe(2)
    expect(getTaskChatState(PROJECT, TASK, { fromIndex: 2 }).turns).toEqual([])
  })

  test('blocked with stepRunning while a job runs — sending is impossible then', () => {
    writeJob({ id: 'j-live', status: 'running', sessionId: 's1', finishedAt: null })
    const state = getTaskChatState(PROJECT, TASK)
    expect(state).toMatchObject({ canSend: false, blockedReason: 'stepRunning' })
    expect(state.running).toMatchObject({ jobId: 'j-live' })
  })

  test('blocked with noCompletedJob when the task has never finished a job', () => {
    expect(getTaskChatState(PROJECT, TASK)).toMatchObject({ canSend: false, blockedReason: 'noCompletedJob' })
  })

  test('canSend when a job finished even if the ledger session is closed (starts a new session)', () => {
    writeJob({ id: 'j1', sessionId: 's1' })
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [ledgerEntry({ sessionId: 's1', status: 'closed' })],
    })
    const state = getTaskChatState(PROJECT, TASK)
    expect(state.canSend).toBe(true)
    expect(state.blockedReason).toBeUndefined()
  })

  test('canSend once a job finished and the ledger still has an open session', () => {
    writeJob({ id: 'j1', sessionId: 's1' })
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [ledgerEntry({ sessionId: 's1' })],
    })
    const state = getTaskChatState(PROJECT, TASK)
    expect(state.canSend).toBe(true)
    expect(state.blockedReason).toBeUndefined()
  })

  test('reports the runner of the step, resolved from the registry', () => {
    // Registered runner → name + enabled from the registry.
    upsertConnection({ id: 'conn-chat', kind: 'local-console', providerId: 'stub-taskchat', cliPath: 'stub' })
    upsertRunner({ id: 'runner-chat', name: 'Runner chính', connectionId: 'conn-chat', config: {} })
    writeJob({ id: 'j1', runnerId: 'runner-chat', sessionId: 's1' })

    expect(getTaskChatState(PROJECT, TASK).runner).toEqual({
      id: 'runner-chat',
      name: 'Runner chính',
      enabled: true,
    })
  })

  test('a runner id no longer in the registry is reported as disabled, not hidden', () => {
    writeJob({ id: 'j1', runnerId: 'runner-deleted', sessionId: 's1' })
    expect(getTaskChatState(PROJECT, TASK).runner).toEqual({
      id: 'runner-deleted',
      name: 'runner-deleted',
      enabled: false,
    })
  })

  test('no job for the task → no runner to report', () => {
    expect(getTaskChatState(PROJECT, TASK).runner).toBeNull()
  })

  test('approval-flow jobs are ignored — they are not part of the task conversation', () => {
    writeJob({ id: 'j-approval', applyTarget: WORKSPACE, approvalArtifact: 'design.md', sessionId: 's-appr' })
    expect(getTaskChatState(PROJECT, TASK)).toMatchObject({ blockedReason: 'noCompletedJob', sessionId: null })
  })
})
