import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodeWorkspacePath } from '../../../../src/features/monitor/business/sessionTranscript'
import { getTaskChatState, resolveChatSession } from '../../../../src/features/monitor/business/taskChat'
import { saveTaskSessionLedger, type SessionEntry } from '../../../../src/features/runner/business/sessionLedger'
import { upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index'
import { appendTranscriptTurn } from '../../../../src/features/runner/business/providers/agentTranscriptStore'
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

  test('dismissed via "+": finished job\'s session closed in ledger, no open replacement → null + flag', () => {
    writeJob({
      id: 'j-design',
      sessionId: 's-design',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'design' },
    })
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [ledgerEntry({ sessionId: 's-design', stepIds: ['design'], status: 'closed' })],
    })
    expect(resolveChatSession(PROJECT, TASK, 'design')).toEqual({ sessionId: null, dismissedForStep: true })
  })

  test('after dismiss + new message: the new job/session for the step wins, not stuck forever', () => {
    writeJob({
      id: 'j-design',
      sessionId: 's-design',
      createdAt: '2026-01-01T00:00:00.000Z',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'design' },
    })
    writeJob({
      id: 'j-design-2',
      sessionId: 's-design-2',
      createdAt: '2026-01-02T00:00:00.000Z',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'design' },
    })
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [
        ledgerEntry({ sessionId: 's-design', stepIds: ['design'], status: 'closed' }),
        ledgerEntry({ sessionId: 's-design-2', stepIds: ['design'], status: 'open' }),
      ],
    })
    const resolved = resolveChatSession(PROJECT, TASK, 'design')
    expect(resolved.sessionId).toBe('s-design-2')
    expect(resolved.dismissedForStep).toBeUndefined()
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

  test('a running job no longer blocks sending — feedback gets queued instead', () => {
    writeJob({ id: 'j-live', status: 'running', sessionId: 's1', finishedAt: null })
    const state = getTaskChatState(PROJECT, TASK)
    expect(state).toMatchObject({ canSend: true, queued: true })
    expect(state.blockedReason).toBeUndefined()
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

  test('after "+": dismissed step session shows an empty chat, not the old job history', () => {
    writeJob({
      id: 'j-design',
      sessionId: 's-design',
      userPrompt: 'Viết design',
      stdout: 'Nội dung cũ',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'design' },
    })
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [ledgerEntry({ sessionId: 's-design', stepIds: ['design'], status: 'closed' })],
    })
    const state = getTaskChatState(PROJECT, TASK, { stepId: 'design' })
    expect(state.sessionId).toBeNull()
    expect(state.turns).toEqual([])
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

  test('falls back to job stdout when Cursor transcript file is missing', () => {
    upsertConnection({
      id: 'conn-cursor',
      kind: 'local-console',
      providerId: 'cursor-cli',
      cliPath: 'agent',
    })
    upsertRunner({ id: 'runner-cursor', name: 'Cursor', connectionId: 'conn-cursor', config: {} })
    writeJob({
      id: 'j-cursor',
      runnerId: 'runner-cursor',
      sessionId: 's-missing-on-disk',
      userPrompt: 'Viết design',
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 1000,
        result: '## Design\n\nNội dung từ stdout.',
        session_id: 's-missing-on-disk',
      }),
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'designer' },
    })

    const state = getTaskChatState(PROJECT, TASK, { stepId: 'designer' })
    expect(state.transcriptFound).toBe(true)
    expect(state.transcriptProvider).toBe('cursor-cli')
    expect(state.turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(state.turns[1]?.text).toContain('Nội dung từ stdout')
  })

  test('job-fallback timeline includes chat-feedback rounds (stable indices)', () => {
    upsertConnection({
      id: 'conn-cursor-fb',
      kind: 'local-console',
      providerId: 'cursor-cli',
      cliPath: 'agent',
    })
    upsertRunner({ id: 'runner-cursor-fb', name: 'Cursor FB', connectionId: 'conn-cursor-fb', config: {} })
    writeJob({
      id: 'j-step',
      runnerId: 'runner-cursor-fb',
      sessionId: 's-fb',
      createdAt: '2026-01-01T00:00:00.000Z',
      userPrompt: 'Viết design',
      stdout: '## Design xong',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'designer' },
    })
    writeJob({
      id: 'j-hello',
      runnerId: 'runner-cursor-fb',
      sessionId: 's-fb',
      createdAt: '2026-01-02T00:00:00.000Z',
      userPrompt: 'hello',
      stdout: JSON.stringify({ result: 'Chào từ feedback', session_id: 's-fb' }),
      metadata: {
        taskId: TASK,
        projectId: PROJECT,
        pipelineStepId: 'designer',
        isChatFeedback: true,
      },
    })

    const state = getTaskChatState(PROJECT, TASK, { stepId: 'designer' })
    expect(state.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(state.turns[2]?.text).toBe('hello')
    expect(state.turns[3]?.text).toContain('Chào từ feedback')
    expect(state.total).toBe(4)
    // Poll cursor: from=2 returns only the feedback round.
    const page = getTaskChatState(PROJECT, TASK, { stepId: 'designer', fromIndex: 2 })
    expect(page.turns.map((t) => t.text)).toEqual(['hello', 'Chào từ feedback'])
    expect(page.total).toBe(4)
  })

  test('strips the <timestamp>/<user_query> wrapper from job-fallback stdout too', () => {
    upsertConnection({
      id: 'conn-cursor-wrap',
      kind: 'local-console',
      providerId: 'cursor-cli',
      cliPath: 'agent',
    })
    upsertRunner({ id: 'runner-cursor-wrap', name: 'Cursor wrap', connectionId: 'conn-cursor-wrap', config: {} })
    writeJob({
      id: 'j-cursor-wrap',
      runnerId: 'runner-cursor-wrap',
      sessionId: 's-missing-wrap',
      userPrompt: 'Viết design',
      stdout: JSON.stringify({
        result: '<timestamp>2026-01-01T00:00:00Z</timestamp><user_query>Nội dung từ stdout.</user_query>',
        session_id: 's-missing-wrap',
      }),
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'designer' },
    })

    const state = getTaskChatState(PROJECT, TASK, { stepId: 'designer' })
    expect(state.turns[1]?.text).toBe('Nội dung từ stdout.')
  })

  test('falls back to job log Phản hồi section when stdout is not persisted', () => {
    const logDir = path.join(home, 'jobs')
    fs.mkdirSync(logDir, { recursive: true })
    const logPath = path.join(logDir, 'j-log.log')
    fs.writeFileSync(
      logPath,
      [
        '=== Payload gửi cho runner ===',
        '--- Prompt ---',
        'hello',
        '',
        '=== Phản hồi của runner (stdout/stderr) ===',
        '',
        '{"result":"Trả lời từ log","session_id":"s-log"}',
        '',
        '=== Kết quả ===',
        'ok: true',
        '',
      ].join('\n'),
      'utf8',
    )
    upsertConnection({
      id: 'conn-cursor-2',
      kind: 'local-console',
      providerId: 'cursor-cli',
      cliPath: 'agent',
    })
    upsertRunner({ id: 'runner-cursor-2', name: 'Cursor 2', connectionId: 'conn-cursor-2', config: {} })
    writeJob({
      id: 'j-log',
      runnerId: 'runner-cursor-2',
      sessionId: 's-log',
      userPrompt: 'hello',
      logPath,
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'designer' },
    })

    const state = getTaskChatState(PROJECT, TASK, { stepId: 'designer' })
    expect(state.transcriptFound).toBe(true)
    expect(state.turns.some((t) => t.role === 'assistant' && t.text.includes('Trả lời từ log'))).toBe(true)
  })

  test('an AgenticApiProvider job (openai-api) reads tool-call turns via apiAgentTranscript', () => {
    upsertConnection({
      id: 'conn-openai',
      kind: 'ai-provider',
      providerId: 'openai-api',
      credentialId: 'cred-openai',
    })
    upsertRunner({ id: 'runner-openai', name: 'OpenAI', connectionId: 'conn-openai', config: {} })
    appendTranscriptTurn('openai-api', 's-openai', { role: 'user', text: 'Viết design' })
    appendTranscriptTurn('openai-api', 's-openai', { role: 'tool', tool: 'write_file', text: '{"path":"design.md"}' })
    appendTranscriptTurn('openai-api', 's-openai', { role: 'assistant', text: '## Design xong' })
    writeJob({
      id: 'j-openai',
      runnerId: 'runner-openai',
      sessionId: 's-openai',
      userPrompt: 'Viết design',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'designer' },
    })

    const state = getTaskChatState(PROJECT, TASK, { stepId: 'designer' })
    expect(state.transcriptFound).toBe(true)
    expect(state.transcriptProvider).toBe('openai-api')
    expect(state.turns.map((t) => t.role)).toEqual(['user', 'tool', 'assistant'])
    expect(state.turns[1]?.tool).toBe('write_file')
  })

  test('an AgenticApiProvider job (anthropic-api) resolves the same way — no per-provider id list to fall out of sync', () => {
    upsertConnection({
      id: 'conn-anthropic',
      kind: 'ai-provider',
      providerId: 'anthropic-api',
      credentialId: 'cred-anthropic',
    })
    upsertRunner({ id: 'runner-anthropic', name: 'Anthropic', connectionId: 'conn-anthropic', config: {} })
    appendTranscriptTurn('anthropic-api', 's-anthropic', { role: 'user', text: 'Viết design' })
    appendTranscriptTurn('anthropic-api', 's-anthropic', { role: 'tool', tool: 'str_replace_based_edit_tool', text: '{"path":"design.md"}' })
    appendTranscriptTurn('anthropic-api', 's-anthropic', { role: 'assistant', text: '## Design xong' })
    writeJob({
      id: 'j-anthropic',
      runnerId: 'runner-anthropic',
      sessionId: 's-anthropic',
      userPrompt: 'Viết design',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'designer' },
    })

    const state = getTaskChatState(PROJECT, TASK, { stepId: 'designer' })
    expect(state.transcriptFound).toBe(true)
    expect(state.transcriptProvider).toBe('anthropic-api')
    expect(state.turns.map((t) => t.role)).toEqual(['user', 'tool', 'assistant'])
    expect(state.turns[1]?.tool).toBe('str_replace_based_edit_tool')
  })
})
