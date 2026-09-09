import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clearStaleInFlight,
  getRuleState,
  listRuns,
  removeRuleRuntime,
  saveRun,
  setRuleState,
} from '../../../../src/features/automations/business/runLedger.js'
import type { AutomationRun } from '../../../../src/features/automations/schemas/automation.js'

/**
 * Runtime state + lịch sử chạy của automations (`business/runLedger.ts`).
 * Persist ở `registryHome()/automations/<projectKey>/` nên suite phải trỏ
 * `DEV_TEAM_DASHBOARD_HOME` sang tmp — nếu không sẽ ghi vào
 * `~/.dev-team-dashboard` thật của máy chạy test.
 *
 * Điểm nhìn: state sống sót qua restart (đọc lại từ đĩa), prune giữ đúng số bản
 * gần nhất, và một file hỏng không làm sập cả danh sách.
 */

const MAX_RUNS_PER_PROJECT = 50
const PROJECT = 'proj-ledger'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function projectDir(projectId: string): string {
  return path.join(home, 'automations', projectId)
}

function runsDir(projectId: string): string {
  return path.join(projectDir(projectId), 'runs')
}

function makeRun(over: Partial<AutomationRun> & { runId: string }): AutomationRun {
  return {
    version: 1,
    automationId: 'rule-a',
    projectId: PROJECT,
    source: 'manual',
    triggerId: 'manual',
    triggerKind: 'manual',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: null,
    outcome: 'running',
    ...over,
  }
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-run-ledger-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(path.join(home, 'automations'), { recursive: true, force: true })
})

describe('projectKey — tên thư mục an toàn cho filesystem', () => {
  test('projectId rỗng / null / undefined → thư mục "default"', () => {
    for (const id of ['', '   ', null, undefined]) {
      setRuleState(id, 'rule-x', { lastRunAt: '2026-01-01T00:00:00.000Z', lastOutcome: 'succeeded' })
      expect(fs.existsSync(path.join(projectDir('default'), 'state.json'))).toBe(true)
      fs.rmSync(path.join(home, 'automations'), { recursive: true, force: true })
    }
  })

  test('ký tự ngoài [\\w.-] bị thay bằng "-" (chặn path traversal)', () => {
    setRuleState('a/b c!', 'rule-x', { lastRunAt: null, lastOutcome: null })

    expect(fs.existsSync(path.join(projectDir('a-b-c-'), 'state.json'))).toBe(true)
    // Không tạo thư mục lồng theo dấu '/' của projectId.
    expect(fs.existsSync(path.join(home, 'automations', 'a'))).toBe(false)
  })

  test('projectId dài bị cắt còn 80 ký tự', () => {
    const long = 'p'.repeat(200)
    setRuleState(long, 'rule-x', { lastRunAt: null, lastOutcome: null })

    const dirs = fs.readdirSync(path.join(home, 'automations'))
    expect(dirs).toEqual(['p'.repeat(80)])
  })
})

describe('getRuleState / setRuleState', () => {
  test('chưa có state.json → state rỗng mặc định, không throw', () => {
    expect(getRuleState(PROJECT, 'rule-a')).toEqual({ lastRunAt: null, lastOutcome: null })
  })

  test('rule chưa có bản ghi trong state.json có sẵn → state mặc định', () => {
    setRuleState(PROJECT, 'rule-a', { lastRunAt: '2026-01-01T00:00:00.000Z', lastOutcome: 'succeeded' })

    expect(getRuleState(PROJECT, 'rule-khac')).toEqual({ lastRunAt: null, lastOutcome: null })
  })

  test('round-trip: ghi rồi đọc lại đúng, atomic (không để lại .tmp)', () => {
    const state = {
      lastRunAt: '2026-02-03T04:05:06.000Z',
      lastOutcome: 'failed' as const,
      triggerFired: { t1: true },
      inFlight: true,
    }
    setRuleState(PROJECT, 'rule-a', state)

    expect(getRuleState(PROJECT, 'rule-a')).toEqual(state)
    expect(fs.readdirSync(projectDir(PROJECT))).toEqual(['state.json'])
  })

  test('ghi rule thứ hai không xoá rule thứ nhất', () => {
    setRuleState(PROJECT, 'rule-a', { lastRunAt: null, lastOutcome: 'succeeded' })
    setRuleState(PROJECT, 'rule-b', { lastRunAt: null, lastOutcome: 'failed' })

    expect(getRuleState(PROJECT, 'rule-a').lastOutcome).toBe('succeeded')
    expect(getRuleState(PROJECT, 'rule-b').lastOutcome).toBe('failed')
  })

  test('state.json hỏng / version lạ → đọc về state mặc định thay vì throw', () => {
    fs.mkdirSync(projectDir(PROJECT), { recursive: true })
    fs.writeFileSync(path.join(projectDir(PROJECT), 'state.json'), '{ không phải json')
    expect(getRuleState(PROJECT, 'rule-a')).toEqual({ lastRunAt: null, lastOutcome: null })

    fs.writeFileSync(path.join(projectDir(PROJECT), 'state.json'), JSON.stringify({ version: 9, rules: {} }))
    expect(getRuleState(PROJECT, 'rule-a')).toEqual({ lastRunAt: null, lastOutcome: null })
  })
})

describe('clearStaleInFlight — startup sweep', () => {
  test('rule đang inFlight về false, các field khác giữ nguyên', () => {
    setRuleState(PROJECT, 'rule-a', {
      lastRunAt: '2026-01-01T00:00:00.000Z',
      lastOutcome: 'running',
      triggerFired: { t1: true },
      inFlight: true,
    })

    clearStaleInFlight(PROJECT)

    expect(getRuleState(PROJECT, 'rule-a')).toEqual({
      lastRunAt: '2026-01-01T00:00:00.000Z',
      lastOutcome: 'running',
      triggerFired: { t1: true },
      inFlight: false,
    })
  })

  test('không có rule nào inFlight → state không đổi (không ghi lại file)', () => {
    setRuleState(PROJECT, 'rule-a', { lastRunAt: null, lastOutcome: null })
    const before = fs.readFileSync(path.join(projectDir(PROJECT), 'state.json'), 'utf8')

    clearStaleInFlight(PROJECT)

    expect(fs.readFileSync(path.join(projectDir(PROJECT), 'state.json'), 'utf8')).toBe(before)
  })

  test('project chưa có state → no-op, không throw', () => {
    expect(() => clearStaleInFlight('proj-chua-co')).not.toThrow()
  })
})

describe('saveRun / listRuns', () => {
  test('trả mới nhất trước và tôn trọng limit', () => {
    for (const [i, startedAt] of ['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z'].entries()) {
      saveRun(makeRun({ runId: `run-${i + 1}`, startedAt }))
    }

    expect(listRuns(PROJECT).map((r) => r.runId)).toEqual(['run-3', 'run-2', 'run-1'])
    expect(listRuns(PROJECT, 2).map((r) => r.runId)).toEqual(['run-3', 'run-2'])
  })

  test('ghi lại cùng runId thì cập nhật, không nhân bản', () => {
    saveRun(makeRun({ runId: 'run-1' }))
    saveRun(makeRun({ runId: 'run-1', outcome: 'succeeded', finishedAt: '2026-01-01T00:01:00.000Z' }))

    const runs = listRuns(PROJECT)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ outcome: 'succeeded', finishedAt: '2026-01-01T00:01:00.000Z' })
  })

  test(`prune: ghi quá ${MAX_RUNS_PER_PROJECT} bản → chỉ giữ ${MAX_RUNS_PER_PROJECT} bản gần nhất`, () => {
    for (let i = 1; i <= MAX_RUNS_PER_PROJECT + 5; i++) {
      saveRun(
        makeRun({
          runId: `run-${String(i).padStart(3, '0')}`,
          startedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        }),
      )
    }

    expect(fs.readdirSync(runsDir(PROJECT))).toHaveLength(MAX_RUNS_PER_PROJECT)
    const kept = listRuns(PROJECT, MAX_RUNS_PER_PROJECT).map((r) => r.runId)
    expect(kept[0]).toBe(`run-${String(MAX_RUNS_PER_PROJECT + 5).padStart(3, '0')}`)
    expect(kept).not.toContain('run-001')
  })

  test('thư mục runs/ không tồn tại → [] (không throw)', () => {
    expect(listRuns('proj-khong-co-runs')).toEqual([])
  })

  test('file JSON hỏng / thiếu runId bị bỏ qua, danh sách còn lại vẫn đọc được', () => {
    saveRun(makeRun({ runId: 'run-ok', startedAt: '2026-01-02T00:00:00.000Z' }))
    fs.writeFileSync(path.join(runsDir(PROJECT), 'run-hong.json'), '{ không phải json')
    fs.writeFileSync(path.join(runsDir(PROJECT), 'run-thieu.json'), JSON.stringify({ version: 1 }))

    expect(listRuns(PROJECT).map((r) => r.runId)).toEqual(['run-ok'])
  })

  test('limit ≤ 0 vẫn trả ít nhất 1 bản (không trả rỗng bất ngờ)', () => {
    saveRun(makeRun({ runId: 'run-1' }))

    expect(listRuns(PROJECT, 0)).toHaveLength(1)
    expect(listRuns(PROJECT, -5)).toHaveLength(1)
  })

  test('run của project khác không lẫn vào danh sách', () => {
    saveRun(makeRun({ runId: 'run-a' }))
    saveRun(makeRun({ runId: 'run-b', projectId: 'proj-khac' }))

    expect(listRuns(PROJECT).map((r) => r.runId)).toEqual(['run-a'])
    expect(listRuns('proj-khac').map((r) => r.runId)).toEqual(['run-b'])
  })
})

describe('removeRuleRuntime', () => {
  test('xoá state + history của đúng rule, rule khác còn nguyên', () => {
    setRuleState(PROJECT, 'rule-a', { lastRunAt: null, lastOutcome: 'succeeded' })
    setRuleState(PROJECT, 'rule-b', { lastRunAt: null, lastOutcome: 'failed' })
    saveRun(makeRun({ runId: 'run-a', automationId: 'rule-a' }))
    saveRun(makeRun({ runId: 'run-b', automationId: 'rule-b' }))

    removeRuleRuntime(PROJECT, 'rule-a')

    expect(getRuleState(PROJECT, 'rule-a')).toEqual({ lastRunAt: null, lastOutcome: null })
    expect(getRuleState(PROJECT, 'rule-b').lastOutcome).toBe('failed')
    expect(listRuns(PROJECT).map((r) => r.runId)).toEqual(['run-b'])
  })

  test('rule chưa từng chạy → no-op, không throw', () => {
    expect(() => removeRuleRuntime(PROJECT, 'rule-chua-co')).not.toThrow()
  })
})
