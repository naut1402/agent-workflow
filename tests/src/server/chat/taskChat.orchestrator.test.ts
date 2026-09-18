import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodeWorkspacePath } from '../../../../src/features/monitor/business/sessionTranscript'
import { getTaskChatState, resolveChatSession } from '../../../../src/features/monitor/business/taskChat'
import { saveTaskSessionLedger, type SessionEntry } from '../../../../src/features/runner/business/sessionLedger'
import { upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index'
import { DECISION_SENTINEL, ORCHESTRATOR_STEP_ID } from '../../../../src/shared/lib/orchestrator'
import type { JobRecord } from '../../../../src/features/runner/business/types'

// Hiện tượng ② của đề bài: "chat với node điều phối chỉ hiển thị thông tin khung
// chat của node đầu tiên". Khung chat của node là một bề mặt người dùng đọc trực
// tiếp, nên mọi case dưới đây chấm trên thứ panel hiển thị — phiên nào đang mở,
// lượt nào hiện ra, runner nào được nêu tên, gửi đi có bị xếp hàng không.

const PROJECT = 'P-orch-chat'
const TASK = 'ORCH-1'
const WORKSPACE = path.join('C:', 'work', 'tasks', 'ORCH-1')

let home: string
let configDir: string
const savedEnv = { ...process.env }

function writeJob(job: Partial<JobRecord> & { id: string }): void {
  const dir = path.join(home, 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  const full = {
    status: 'succeeded',
    runnerId: 'r-step',
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

/** Một lượt của node điều phối — job mang cờ `orchestratorJob`, không mang step nào. */
function orchestratorTurn(over: Partial<JobRecord> & { id: string }): void {
  writeJob({
    runnerId: 'r-orch',
    metadata: {
      taskId: TASK,
      projectId: PROJECT,
      stepId: ORCHESTRATOR_STEP_ID,
      orchestratorJob: true,
      orchestratorTrigger: 'step_finished',
    },
    ...over,
  })
}

function writeTranscript(sessionId: string, texts: string[]): void {
  const dir = path.join(configDir, 'projects', encodeWorkspacePath(WORKSPACE))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${sessionId}.jsonl`),
    texts
      .map(
        (t) =>
          `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } })}\n`,
      )
      .join(''),
    'utf8',
  )
}

function ledgerEntry(over: Partial<SessionEntry> & { sessionId: string }): SessionEntry {
  return {
    providerId: 'claude-code-cli',
    runnerId: 'r-orch',
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
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-chat-home-'))
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-chat-cfg-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.CLAUDE_CONFIG_DIR = configDir
  // Hai runner có TÊN khác nhau: đó là cách thấy panel đang nói về runner nào.
  upsertConnection({ id: 'c1', kind: 'local-console', providerId: 'claude-code-cli', cliPath: 'stub' })
  upsertRunner({ id: 'r-step', name: 'Runner của step', connectionId: 'c1', config: {} })
  upsertRunner({ id: 'r-orch', name: 'Runner của node điều phối', connectionId: 'c1', config: {} })
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

describe('resolveChatSession — khung chat của node điều phối (TC-13)', () => {
  test('phiên của node thắng, kể cả khi step-1 vừa chạy xong sau đó', () => {
    orchestratorTurn({ id: 'j-orch', sessionId: 's-orch', createdAt: '2026-01-01T00:00:00.000Z' })
    writeJob({
      id: 'j-step',
      sessionId: 's-step',
      createdAt: '2026-01-01T00:05:00.000Z',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'investigator' },
    })

    expect(resolveChatSession(PROJECT, TASK, ORCHESTRATOR_STEP_ID)).toMatchObject({ sessionId: 's-orch' })
  })

  // Đây chính là đường rò của hiện tượng ②: một step ĐANG CHẠY không được chiếm
  // khung chat của node.
  test('step đang chạy KHÔNG chiếm khung chat của node', () => {
    orchestratorTurn({ id: 'j-orch', sessionId: 's-orch' })
    writeJob({
      id: 'j-running',
      sessionId: 's-step',
      status: 'running',
      finishedAt: null,
      createdAt: '2026-01-01T00:05:00.000Z',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'investigator' },
    })

    expect(resolveChatSession(PROJECT, TASK, ORCHESTRATOR_STEP_ID)).toMatchObject({ sessionId: 's-orch' })
  })

  test('node chưa chạy lượt nào ⇒ khung rỗng, KHÔNG mượn phiên của step', () => {
    writeJob({
      id: 'j-step',
      sessionId: 's-step',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'investigator' },
    })
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [ledgerEntry({ sessionId: 's-step', stepIds: ['investigator'], runnerId: 'r-step' })],
    })

    expect(resolveChatSession(PROJECT, TASK, ORCHESTRATOR_STEP_ID)).toEqual({ sessionId: null })
  })

  test('không còn job nhưng ledger còn entry của node ⇒ vẫn mở đúng phiên đó (TC-12)', () => {
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [
        ledgerEntry({ sessionId: 's-step', stepIds: ['investigator'], runnerId: 'r-step' }),
        ledgerEntry({ sessionId: 's-orch', stepIds: [ORCHESTRATOR_STEP_ID] }),
      ],
    })

    expect(resolveChatSession(PROJECT, TASK, ORCHESTRATOR_STEP_ID)).toMatchObject({ sessionId: 's-orch' })
  })

  // TC-17 — chat với node step vẫn hoạt động như cũ, không lẫn sang node điều phối.
  test('khung chat của step-1 KHÔNG bị lượt điều phối chiếm', () => {
    writeJob({
      id: 'j-step',
      sessionId: 's-step',
      createdAt: '2026-01-01T00:00:00.000Z',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'investigator' },
    })
    orchestratorTurn({ id: 'j-orch', sessionId: 's-orch', createdAt: '2026-01-01T00:05:00.000Z' })
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [
        ledgerEntry({ sessionId: 's-step', stepIds: ['investigator'], runnerId: 'r-step' }),
        ledgerEntry({ sessionId: 's-orch', stepIds: [ORCHESTRATOR_STEP_ID] }),
      ],
    })

    expect(resolveChatSession(PROJECT, TASK, 'investigator')).toMatchObject({ sessionId: 's-step' })
  })
})

describe('getTaskChatState — panel của node điều phối (TC-13, TC-14)', () => {
  test('lượt hiện ra là lượt của node, KHÔNG phải hội thoại của step-1', () => {
    writeJob({
      id: 'j-step',
      sessionId: 's-step',
      userPrompt: 'brief của investigator',
      stdout: 'PING-step-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'investigator' },
    })
    orchestratorTurn({
      id: 'j-orch',
      sessionId: 's-orch',
      userPrompt: 'PING-abc123',
      stdout: 'Pipeline đang chờ người duyệt cổng.',
      createdAt: '2026-01-01T00:05:00.000Z',
    })

    const state = getTaskChatState(PROJECT, TASK, { stepId: ORCHESTRATOR_STEP_ID })
    const texts = state.turns.map((t) => t.text).join('\n')
    expect(state.sessionId).toBe('s-orch')
    expect(texts).toContain('PING-abc123')
    expect(texts).toContain('Pipeline đang chờ người duyệt cổng.')
    expect(texts).not.toContain('PING-step-1')
  })

  test('hai lượt liên tiếp nằm cùng một hội thoại, đúng thứ tự gửi (TC-14)', () => {
    orchestratorTurn({
      id: 'j-orch-1',
      sessionId: 's-orch',
      userPrompt: 'CAU-1',
      stdout: 'đáp 1',
      createdAt: '2026-01-01T00:01:00.000Z',
    })
    orchestratorTurn({
      id: 'j-orch-2',
      sessionId: 's-orch',
      userPrompt: 'CAU-2',
      stdout: 'đáp 2',
      createdAt: '2026-01-01T00:02:00.000Z',
    })

    const texts = getTaskChatState(PROJECT, TASK, { stepId: ORCHESTRATOR_STEP_ID }).turns.map((t) => t.text)
    expect(texts.indexOf('CAU-1')).toBeGreaterThanOrEqual(0)
    expect(texts.indexOf('CAU-1')).toBeLessThan(texts.indexOf('CAU-2'))
  })

  // Dòng quyết định là lệnh máy, không phải câu nói — người dùng đọc nhật ký
  // điều phối thì không được thấy nó.
  test('dòng lệnh máy bị giấu khỏi khung chat của node', () => {
    orchestratorTurn({
      id: 'j-orch',
      sessionId: 's-orch',
      userPrompt: 'tóm tắt giúp tôi',
      stdout: [
        'Investigate đã xong, chuyển sang implementer.',
        `${DECISION_SENTINEL} {"action":"start","stepId":"implementer","context":"bí mật máy"}`,
      ].join('\n'),
    })

    const texts = getTaskChatState(PROJECT, TASK, { stepId: ORCHESTRATOR_STEP_ID }).turns.map((t) => t.text).join('\n')
    expect(texts).toContain('Investigate đã xong, chuyển sang implementer.')
    expect(texts).not.toContain(DECISION_SENTINEL)
    expect(texts).not.toContain('bí mật máy')
  })

  // TC-15: node thấy bối cảnh CẢ pipeline. Transcript của phiên node là nơi lịch
  // sử đó sống — panel phải đọc nó, không dựng lại từ job của step nào khác.
  test('transcript thật trên đĩa của phiên node được dùng khi có', () => {
    orchestratorTurn({ id: 'j-orch', sessionId: 's-orch' })
    writeTranscript('s-orch', ['Tôi đã theo dõi cả 3 bước: M2-marker và M3-marker.'])

    const state = getTaskChatState(PROJECT, TASK, { stepId: ORCHESTRATOR_STEP_ID })
    expect(state.transcriptFound).toBe(true)
    expect(state.turns.map((t) => t.text).join('\n')).toContain('M3-marker')
  })

  // [Bug nguồn — xem test-result.md] Panel của node phải nói về NODE: runner của
  // node, không có job step nào đang chạy chiếm chỗ, và ô nhập không báo "sẽ xếp
  // hàng" trong khi đường gửi của node đi thẳng.
  test('step đang chạy KHÔNG rò trạng thái vào panel của node', () => {
    orchestratorTurn({
      id: 'j-orch',
      sessionId: 's-orch',
      userPrompt: 'hỏi node',
      stdout: 'đáp của node',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    writeJob({
      id: 'j-running',
      sessionId: 's-step',
      status: 'running',
      finishedAt: null,
      createdAt: '2026-01-01T00:05:00.000Z',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'investigator' },
    })

    const state = getTaskChatState(PROJECT, TASK, { stepId: ORCHESTRATOR_STEP_ID })
    expect(state.running).toBeNull()
    expect(state.queued).toBe(false)
    expect(state.runner?.id).toBe('r-orch')
  })

  test('panel của step-1 vẫn nêu runner của step-1 (TC-17)', () => {
    writeJob({
      id: 'j-step',
      sessionId: 's-step',
      userPrompt: 'brief',
      stdout: 'ra kết quả',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'investigator' },
    })

    expect(getTaskChatState(PROJECT, TASK, { stepId: 'investigator' }).runner?.id).toBe('r-step')
  })

  test('chưa có lượt nào của node ⇒ panel rỗng, không mượn runner của step', () => {
    writeJob({
      id: 'j-step',
      sessionId: 's-step',
      userPrompt: 'brief',
      stdout: 'ra kết quả',
      metadata: { taskId: TASK, projectId: PROJECT, pipelineStepId: 'investigator' },
    })

    const state = getTaskChatState(PROJECT, TASK, { stepId: ORCHESTRATOR_STEP_ID })
    expect(state.sessionId).toBeNull()
    expect(state.turns).toEqual([])
    expect(state.runner).toBeNull()
  })
})
