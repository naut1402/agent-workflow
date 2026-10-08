// Tf2f484e2 · TC-F01 — bất biến "prompt và runner KHÔNG BAO GIỜ lệch tuyến".
//
// `design.md` §5 chỉ test hai phía rời nhau (prompt ở T1, runner ở T4). Test
// từng phía 🚫 không loại trừ được tổ hợp lệch — và tổ hợp (prompt dạy gọi tool,
// job không được gắn tool) là đúng kiểu hỏng tệ nhất: agent gọi một tool không
// tồn tại rồi lượt điều phối đứng im.
//
// Ca này chạy MỘT LƯỢT ĐIỀU PHỐI THẬT tới mức `submitJob`, rồi đọc lại từ chính
// bản ghi job: `userPrompt` (prompt đã dùng) và `metadata.orchestratorMcpRoute`
// (giá trị runner sẽ đọc). Hai thứ đó phải là MỘT.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _resetEventBusForTest } from '../../../../src/backend/events/index.js'
import {
  _resetOrchestratorForTest,
  handleEvent,
} from '../../../../src/features/orchestrator/business/decisionLoop.js'
import {
  listJobs,
  setDefaultRunner,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import { resolveDecisionRoute } from '../../../../src/features/orchestrator/business/mcpRoute.js'

const SELF_BASE_URL = 'http://127.0.0.1:54999'

let home: string
let root: string
const savedEnv = { ...process.env }

const MCP_HEADING = '## Cách ra lệnh (bắt buộc)'
const SENTINEL_HEADING = '## Định dạng trả lời (bắt buộc)'

function writePipeline() {
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      'orchestrator: { enabled: true, agent: "a:orch" }',
      'steps:',
      '  - { id: implementer, name: Implement, agent: "a:impl" }',
      '  - { id: reviewer, name: Review, agent: "a:rev" }',
    ].join('\n'),
    'utf8',
  )
}

function seedTask(taskId: string) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), '# yêu cầu\n', 'utf8')
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: 'reviewer', orchestrator_enabled: true }),
    'utf8',
  )
}

/** Job step đã chạy xong — mốc duy nhất mở lượt điều phối. */
function finishedStepJob(id: string, taskId: string): string {
  const dir = path.join(home, 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      status: 'succeeded',
      runnerId: 'r',
      agentRef: 'a',
      workspace: path.join(root, 'tasks', taskId),
      createdAt: new Date().toISOString(),
      stdout: 'step xong',
      artifactsFound: ['implement.md'],
      metadata: { devTeamRoot: root, taskId, pipelineStepId: 'implementer' },
    }),
    'utf8',
  )
  return id
}

/** Lượt điều phối đã submit cho task — đọc lại đúng thứ runner sẽ đọc. */
function turnsOf(taskId: string): any[] {
  return listJobs(200).filter(
    (j) => j.metadata?.taskId === taskId && j.metadata?.orchestratorJob === true && j.userPrompt,
  )
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-route-inv-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-route-inv-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  // Runner mặc định claude-style, cố định cho CẢ HAI ca: biến duy nhất thay đổi
  // giữa hai lượt là trạng thái MCP, đúng tinh thần "chọn ở runtime".
  upsertConnection({
    id: 'conn-claude',
    kind: 'local-console',
    providerId: 'claude-code-cli',
    cliPath: path.join(home, 'khong-ton-tai-cli'),
  })
  upsertRunner({ id: 'r-default', connectionId: 'conn-claude', config: {} })
  setDefaultRunner('r-default')
})

afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  _resetEventBusForTest()
  _resetOrchestratorForTest()
  writePipeline()
  process.env.DEV_TEAM_SELF_BASE_URL = SELF_BASE_URL
})

afterEach(() => _resetEventBusForTest())

describe('TC-F01: một lượt điều phối chỉ có MỘT tuyến', () => {
  async function runOneTurn(taskId: string): Promise<any> {
    seedTask(taskId)
    const jobId = finishedStepJob(`j-${taskId}`, taskId)
    await handleEvent({
      type: 'job.finished',
      at: new Date().toISOString(),
      payload: { jobId, taskId, devTeamRoot: root },
    })
    const turns = turnsOf(taskId)
    expect(turns).toHaveLength(1)
    return turns[0]
  }

  test('trạng thái đủ điều kiện ⇒ prompt dạy gọi tool VÀ metadata đóng dấu `mcp`', async () => {
    expect(resolveDecisionRoute().route).toBe('mcp')
    const turn = await runOneTurn('F1')

    expect(turn.metadata.orchestratorMcpRoute).toBe('mcp')
    expect(turn.userPrompt).toContain(MCP_HEADING)
    expect(turn.userPrompt).not.toContain(SENTINEL_HEADING)
  })

  test('trạng thái thiếu điều kiện ⇒ prompt giao thức cũ VÀ metadata đóng dấu `sentinel`', async () => {
    delete process.env.DEV_TEAM_SELF_BASE_URL
    expect(resolveDecisionRoute().route).toBe('sentinel')
    const turn = await runOneTurn('F2')

    expect(turn.metadata.orchestratorMcpRoute).toBe('sentinel')
    expect(turn.userPrompt).toContain(SENTINEL_HEADING)
    expect(turn.userPrompt).not.toContain(MCP_HEADING)
  })

  /**
   * ⚠️ Mệnh đề đầy đủ của bất biến: 🚫 KHÔNG tồn tại tổ hợp (prompt `mcp`, job
   * đóng dấu `sentinel`) hay ngược lại — ở BẤT KỲ trạng thái nào.
   *
   * Hai ca trên chấm từng trạng thái; ca này chấm chính mối nối, bằng cách suy
   * tuyến TỪ PROMPT rồi so với dấu trong metadata.
   */
  test('tuyến suy từ prompt == tuyến đóng dấu vào metadata, ở CẢ HAI trạng thái', async () => {
    const cases: Array<[string, () => void]> = [
      ['F3', () => void (process.env.DEV_TEAM_SELF_BASE_URL = SELF_BASE_URL)],
      ['F4', () => void delete process.env.DEV_TEAM_SELF_BASE_URL],
    ]
    for (const [taskId, setup] of cases) {
      setup()
      const turn = await runOneTurn(taskId)
      const fromPrompt = turn.userPrompt.includes(MCP_HEADING) ? 'mcp' : 'sentinel'
      expect(fromPrompt, taskId).toBe(turn.metadata.orchestratorMcpRoute)
      // Và prompt 🚫 không bao giờ mang CẢ HAI khối giao thức cùng lúc — dán cả
      // hai vào là bản "sửa" vẫn xanh mọi ca một-phía nhưng vô nghĩa với agent.
      expect(
        turn.userPrompt.includes(MCP_HEADING) && turn.userPrompt.includes(SENTINEL_HEADING),
        taskId,
      ).toBe(false)
    }
  })

  test('token của lượt và dấu tuyến được đóng vào CÙNG một bản ghi job', async () => {
    // `claude-code-cli` chỉ gắn self-MCP khi có ĐỦ cả `orchestratorToken` lẫn
    // `orchestratorMcpRoute === 'mcp'`. Hai giá trị nằm khác bản ghi là có cửa
    // sổ "job mang tool mà thiếu token của nó".
    const turn = await runOneTurn('F5')
    expect(turn.metadata.orchestratorMcpRoute).toBe('mcp')
    expect(typeof turn.metadata.orchestratorToken).toBe('string')
    expect(String(turn.metadata.orchestratorToken).length).toBeGreaterThan(0)
    expect(turn.metadata.orchestratorJob).toBe(true)
  })
})
