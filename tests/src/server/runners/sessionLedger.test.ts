import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  isSessionEntryValid,
  loadTaskSessionLedger,
  recordSessionUsage,
  resolveSessionPlan,
  saveTaskSessionLedger,
  type SessionEntry,
} from '../../../../src/features/runner/business/sessionLedger.js'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const PROJECT = 'proj-a'
const TASK = 'F0010'

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-ledger-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

function seedOpenSession(overrides: Partial<SessionEntry> = {}): SessionEntry {
  const entry: SessionEntry = {
    sessionId: 'sess-open-1',
    providerId: 'claude-code-cli',
    runnerId: 'r1',
    connectionId: 'claude-code-cli-local',
    workspace: '/tmp/ws',
    host: os.hostname(),
    stepIds: ['investigate'],
    status: 'open',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    ...overrides,
  }
  saveTaskSessionLedger(PROJECT, {
    version: 1,
    taskId: TASK,
    sessionPolicy: 'single',
    sessions: [entry],
  })
  return entry
}

describe('sessionLedger', () => {
  test('resolveSessionPlan resume uses open ledger entry (single policy)', () => {
    seedOpenSession()
    const plan = resolveSessionPlan({
      projectId: PROJECT,
      taskId: TASK,
      sessionMode: 'resume',
      providerId: 'claude-code-cli',
      runnerId: 'r1',
      connectionId: 'claude-code-cli-local',
      workspace: '/tmp/ws',
      host: os.hostname(),
    })
    expect(plan.sessionMode).toBe('resume')
    expect(plan.resumeSessionId).toBe('sess-open-1')
  })

  test('resolveSessionPlan resume invalid on host change → new + staleReason', () => {
    seedOpenSession({ host: 'other-machine' })
    const plan = resolveSessionPlan({
      projectId: PROJECT,
      taskId: TASK,
      sessionMode: 'resume',
      providerId: 'claude-code-cli',
      runnerId: 'r1',
      connectionId: 'claude-code-cli-local',
      workspace: '/tmp/ws',
      host: os.hostname(),
    })
    expect(plan.sessionMode).toBe('new')
    expect(plan.staleReason).toBe('host changed')
  })

  test('resolveSessionPlan resume invalid on workspace change', () => {
    seedOpenSession({ workspace: '/other/scratch/proposals/job-1' })
    const plan = resolveSessionPlan({
      projectId: PROJECT,
      taskId: TASK,
      sessionMode: 'resume',
      providerId: 'claude-code-cli',
      runnerId: 'r1',
      connectionId: 'claude-code-cli-local',
      workspace: '/tmp/ws',
      host: os.hostname(),
    })
    expect(plan.sessionMode).toBe('new')
    expect(plan.staleReason).toBe('workspace changed')
  })

  test('resolveSessionPlan resume invalid when session archived', () => {
    const entry = seedOpenSession({ status: 'archived' })
    const check = isSessionEntryValid(entry, {
      host: os.hostname(),
      workspace: '/tmp/ws',
      providerId: 'claude-code-cli',
      connectionId: 'claude-code-cli-local',
    })
    expect(check.invalid).toBe(true)
    expect(check.reason).toBe('session archived')
  })

  test('recordSessionUsage forceNew marks prior open entry stale', () => {
    seedOpenSession()
    recordSessionUsage({
      projectId: PROJECT,
      taskId: TASK,
      sessionId: 'sess-new-2',
      providerId: 'claude-code-cli',
      runnerId: 'r1',
      connectionId: 'claude-code-cli-local',
      workspace: '/tmp/ws',
      forceNew: true,
      staleReason: 'provider changed',
    })
    const ledger = loadTaskSessionLedger(PROJECT, TASK)
    expect(ledger.sessions.filter((s) => s.status === 'stale').length).toBe(1)
    expect(ledger.sessions.find((s) => s.status === 'open')?.sessionId).toBe('sess-new-2')
  })

  test('sessionMode none → no resume id', () => {
    seedOpenSession()
    const plan = resolveSessionPlan({
      projectId: PROJECT,
      taskId: TASK,
      sessionMode: 'none',
      providerId: 'claude-code-cli',
      runnerId: 'r1',
      connectionId: 'claude-code-cli-local',
      workspace: '/tmp/ws',
    })
    expect(plan).toEqual({ sessionMode: 'none' })
  })
})
