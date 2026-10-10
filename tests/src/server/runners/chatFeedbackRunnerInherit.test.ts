import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  deleteRunner,
  loadJob,
  registerProvider,
  sendTaskFeedback,
  setDefaultRunner,
  submitJob,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import type { ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// T6fabee9b · nhóm D của test-spec — `sendTaskFeedback` kế thừa runner của job
// cha, và chỉ giải lại khi runner đó đã XOÁ hoặc TẮT.
//
// Hai mệnh đề ngược chiều nhau phải cùng đúng, nên chúng đi thành cặp:
//
// - TC-D14/TC-D31 — runner của job cha không dùng được nữa ⇒ giải lại (theo pin
//   của step, hoặc default) thay vì để job chết.
// - TC-D15 — runner của job cha CÒN SỐNG ⇒ giữ nguyên, kể cả khi nó là
//   `console-command` và 🚫 không đủ điều kiện làm default. Một job chạy trên
//   runner console vẫn là job hợp lệ; re-resolve ở đây là đổi runner oan và làm
//   hỏng resume session (session id gắn với provider).
//
// `stepRunnerPinStartPaths.test.ts` TC-C10/TC-C10b chốt phần "kế thừa" ở mức
// hành vi mong muốn; file này chốt phần "khi nào thì KHÔNG kế thừa".

const AI_PROVIDER = 'stub-chat-inherit-api'
/** Hậu tố lạ ⇒ họ `console-command` ⇒ 🚫 không đủ điều kiện làm default. */
const CONSOLE_PROVIDER = 'stub-chat-inherit-shell'

const DEFAULT_RUNNER = 'chat-inherit-default'
const PINNED_RUNNER = 'chat-inherit-pinned'
const CONSOLE_RUNNER = 'chat-inherit-console'

function providerOf(id: string): RunnerProvider {
  return {
    providerId: id,
    validateRunnerConfig: () => ({ ok: true, errors: [] }),
    validateCredential: () => ({ ok: true, errors: [] }),
    capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
    async execute(): Promise<ExecuteResult> {
      return { ok: true, exitCode: 0, durationMs: 1 }
    },
  }
}

let home: string
let root: string
const savedEnv = { ...process.env }
const realWarn = console.warn

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function settle(id: string) {
  for (let i = 0; i < 400; i++) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled (status=${loadJob(id)?.status})`)
}

function seedRunner(id: string, providerId: string) {
  upsertConnection({ id: `conn-${id}`, kind: 'local-console', providerId, cliPath: 'stub' })
  upsertRunner({ id, connectionId: `conn-${id}`, config: {} })
}

function seedTask(taskId: string, pin?: string) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: 'implementer' }, null, 2),
    'utf8',
  )
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), 'do the thing', 'utf8')
  fs.writeFileSync(
    path.join(root, 'tasks', taskId, 'pipeline.yaml'),
    [
      'version: 1',
      'steps_replace: true',
      'steps:',
      '  - id: implementer',
      "    agent: ' '",
      ...(pin ? [`    runner_id: '${pin}'`] : []),
      '',
    ].join('\n'),
    'utf8',
  )
}

/** Job cha "đã chạy xong" của step — điều kiện tiên quyết của `sendTaskFeedback`. */
async function parentJobFor(taskId: string, runnerId: string) {
  const job = submitJob({
    runnerId,
    agentRef: '',
    workspace: path.join(root, 'tasks', taskId),
    userPrompt: 'do the thing',
    sessionMode: 'new',
    metadata: {
      projectRoot: path.dirname(root),
      devTeamRoot: root,
      taskId,
      pipelineStepId: 'implementer',
      // Không đẩy `current_phase` — ca nào cũng chỉ cần một job đã kết thúc.
      respawn: true,
      orchestratorDispatch: true,
    },
  })
  await settle(job.id)
  return loadJob(job.id)!
}

/** Bắt `console.warn` cho đúng lượt `sendTaskFeedback`, không dính log lúc chạy job cha. */
async function feedbackWithWarnings(taskId: string) {
  const warnings: string[] = []
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  try {
    const fed = await sendTaskFeedback(taskId, '', 'thêm một ý nữa')
    if (!('job' in fed)) throw new Error(`không nhận được job: ${JSON.stringify(fed)}`)
    return { job: fed.job, warnings }
  } finally {
    console.warn = realWarn
  }
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-chat-inherit-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-chat-inherit-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(providerOf(AI_PROVIDER))
  registerProvider(providerOf(CONSOLE_PROVIDER))
  seedRunner(DEFAULT_RUNNER, AI_PROVIDER)
  seedRunner(PINNED_RUNNER, AI_PROVIDER)
  seedRunner(CONSOLE_RUNNER, CONSOLE_PROVIDER)
  setDefaultRunner(DEFAULT_RUNNER)
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    ['version: 1', 'steps:', '  - id: implementer', "    agent: ' '", ''].join('\n'),
    'utf8',
  )
})
afterAll(() => {
  process.env = savedEnv
  console.warn = realWarn
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})

describe('sendTaskFeedback — runner job cha không dùng được nữa ⇒ giải lại', () => {
  test('TC-D14: runner job cha đã bị XOÁ ⇒ job mới theo pin của step, đúng 1 warn', async () => {
    seedRunner('chat-inherit-tam', AI_PROVIDER)
    seedTask('D14', PINNED_RUNNER)
    const parent = await parentJobFor('D14', 'chat-inherit-tam')
    expect(parent.runnerId).toBe('chat-inherit-tam')
    expect(deleteRunner('chat-inherit-tam')).toEqual({ ok: true })

    const { job, warnings } = await feedbackWithWarnings('D14')

    expect(job.runnerId).toBe(PINNED_RUNNER)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(parent.id)
    expect(warnings[0]).toContain('chat-inherit-tam')
    await settle(job.id)
  })

  test('TC-D31: runner job cha bị TẮT, step KHÔNG pin ⇒ chạy default, 1 warn', async () => {
    seedRunner('chat-inherit-tat', AI_PROVIDER)
    seedTask('D31')
    const parent = await parentJobFor('D31', 'chat-inherit-tat')
    upsertRunner({ id: 'chat-inherit-tat', connectionId: 'conn-chat-inherit-tat', enabled: false, config: {} })

    const { job, warnings } = await feedbackWithWarnings('D31')

    expect(job.runnerId).toBe(DEFAULT_RUNNER)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(parent.id)
    await settle(job.id)
  })
})

describe('sendTaskFeedback — runner job cha còn sống ⇒ GIỮ NGUYÊN', () => {
  test('TC-D15: job cha chạy runner console-command còn sống ⇒ không re-resolve, không warn', async () => {
    seedTask('D15')
    const parent = await parentJobFor('D15', CONSOLE_RUNNER)
    expect(parent.runnerId).toBe(CONSOLE_RUNNER)

    const { job, warnings } = await feedbackWithWarnings('D15')

    // 🚫 Không nhảy sang default AI chỉ vì runner này không đủ điều kiện làm
    // default — "đủ điều kiện làm default" là một câu hỏi khác hẳn.
    expect(job.runnerId).toBe(CONSOLE_RUNNER)
    expect(job.runnerId).not.toBe(DEFAULT_RUNNER)
    expect(warnings).toEqual([])
    await settle(job.id)
  })

  test('TC-D30: job cha có runnerId "unknown" (bản ghi cũ) ⇒ coi như không kế thừa, không warn', async () => {
    seedTask('D30')
    const parent = await parentJobFor('D30', DEFAULT_RUNNER)
    // Job cũ trên đĩa từ trước khi có writeback — `unknown` là chỗ giữ chỗ, không
    // phải một runner id.
    const file = path.join(home, 'jobs', `${parent.id}.json`)
    fs.writeFileSync(file, JSON.stringify({ ...parent, runnerId: 'unknown' }, null, 2), 'utf8')

    const { job, warnings } = await feedbackWithWarnings('D30')

    expect(job.runnerId).toBe(DEFAULT_RUNNER)
    expect(warnings).toEqual([])
    await settle(job.id)
  })
})

describe('TC-D29: id rác 🚫 không lan sang vòng chat kế tiếp', () => {
  test('job cha submit bằng pin đã xoá ⇒ vòng chat kế thừa runner ĐÃ CHẠY, không phải id đã yêu cầu', async () => {
    seedTask('D29')
    // Đúng tình huống TC-D12 ở mức job: yêu cầu một runner không tồn tại, `runJob`
    // rơi về default và ghi lại id thật.
    const parent = await parentJobFor('D29', 'runner-da-bi-xoa')
    expect(parent.runnerId).toBe(DEFAULT_RUNNER)

    const { job, warnings } = await feedbackWithWarnings('D29')

    // Không có C3 thì chỗ này kế thừa `runner-da-bi-xoa` và vòng sau lại rơi tiếp.
    expect(job.runnerId).toBe(DEFAULT_RUNNER)
    expect(warnings).toEqual([])
    await settle(job.id)
  })
})
