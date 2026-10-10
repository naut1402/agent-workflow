import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _resetEventBusForTest, on } from '../../../../src/backend/events/index.js'
import {
  _resetOrchestratorForTest,
  announceHalt,
  handleEvent,
  mintOrchestratorToken,
  recentOf,
  resolveOrchestratorToken,
} from '../../../../src/features/orchestrator/business/index.js'

/**
 * Tfb77cf90-P10 (#449) — `announceHalt(ref, reason)`: phần "báo dừng" dùng chung
 * giữa `haltTask` (agent tự halt) và nút Stop của monitor. Chỉ gồm emit
 * `orchestrator.halted` + thu hồi token: KHÔNG ghi state, KHÔNG quên task.
 */

let home: string
let root: string
const savedEnv = { ...process.env }
const halted: Record<string, unknown>[] = []

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-announce-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-announce-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  _resetEventBusForTest()
  _resetOrchestratorForTest()
  halted.length = 0
  on('orchestrator.halted', (e) => {
    halted.push((e.payload ?? {}) as Record<string, unknown>)
  })
})
afterEach(() => _resetEventBusForTest())

describe('announceHalt', () => {
  test('phát đúng một orchestrator.halted với đúng tập field', () => {
    announceHalt({ root, taskId: 'A1', projectId: 'p1' }, 'user_stop')
    expect(halted).toEqual([{ taskId: 'A1', projectId: 'p1', devTeamRoot: root, reason: 'user_stop' }])
  })

  test('projectId rỗng ⇒ field projectId là undefined (không phải chuỗi rỗng)', () => {
    announceHalt({ root, taskId: 'A2', projectId: '' }, 'x')
    expect(halted).toEqual([{ taskId: 'A2', projectId: undefined, devTeamRoot: root, reason: 'x' }])
  })

  test('thu hồi token của đúng (root, taskId), không đụng task khác', () => {
    const mine = mintOrchestratorToken({ root, taskId: 'A3', projectId: '' })
    const other = mintOrchestratorToken({ root, taskId: 'A4', projectId: '' })
    announceHalt({ root, taskId: 'A3', projectId: '' }, 'x')
    expect(resolveOrchestratorToken(mine)).toBeNull()
    expect(resolveOrchestratorToken(other)).not.toBeNull()
  })

  test('KHÔNG quên bộ nhớ của task và KHÔNG cần state file', async () => {
    await handleEvent({
      type: 'hitl.pending',
      at: new Date().toISOString(),
      payload: { taskId: 'A5', devTeamRoot: root },
    } as any)
    expect(recentOf(root, 'A5')).toHaveLength(1)
    announceHalt({ root, taskId: 'A5', projectId: '' }, 'x')
    expect(recentOf(root, 'A5')).toHaveLength(1)
    expect(halted).toHaveLength(1)
  })
})
