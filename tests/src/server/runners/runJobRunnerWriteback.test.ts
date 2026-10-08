import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadJob,
  registerProvider,
  setDefaultRunner,
  submitJob,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import type { ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// T6fabee9b · nhóm C của test-spec — job record phải nêu runner **thật sự đã
// chạy**, không phải id đã được yêu cầu (G4).
//
// Trước fix, `job.runnerId` giữ nguyên id người gọi truyền vào kể cả khi
// `runJob` đã rơi về runner mặc định. Hệ quả không chỉ là một dòng hiển thị
// sai: vòng chat kế tiếp kế thừa `parent.runnerId`, nên một id rác lan tiếp
// sang các job sau (xem TC-D29 ở `chatFeedbackRunnerInherit.test.ts`).
//
// Nửa còn lại của nhóm là thông điệp lỗi: nó phải GIỮ nguyên văn tiền tố
// `runner not found or disabled` (FE/log đang khớp chuỗi đó) và phân biệt được
// "pin bị tắt" với "default hỏng".

const PROVIDER_ID = 'stub-writeback-api'
const DEFAULT_RUNNER = 'writeback-default'
const PINNED_RUNNER = 'writeback-pinned'

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(): Promise<ExecuteResult> {
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

let home: string
let workspace: string
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
  throw new Error(`job ${id} never settled (status=${loadJob(id)?.status})`)
}

function seedRunner(id: string, opts: { enabled?: boolean } = {}) {
  upsertConnection({ id: `conn-${id}`, kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id, connectionId: `conn-${id}`, enabled: opts.enabled !== false, config: {} })
}

function run(runnerId?: string) {
  return submitJob({ runnerId, agentRef: '', workspace, userPrompt: 'làm việc' })
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-writeback-home-'))
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-writeback-ws-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(workspace, { recursive: true, force: true })
})
beforeEach(() => {
  // Mỗi ca tự dựng lại store: hai ca dưới cố ý TẮT runner, rò rỉ sang ca sau là
  // đỏ vì lý do khác hẳn ý định.
  for (const f of ['runners.json', 'connections.json']) {
    fs.rmSync(path.join(home, f), { force: true })
  }
  seedRunner(DEFAULT_RUNNER)
  seedRunner(PINNED_RUNNER)
  setDefaultRunner(DEFAULT_RUNNER)
})

describe('runJob — ghi lại runner thật sự chạy', () => {
  test('TC-D12: pin trỏ runner ĐÃ XOÁ, default dùng được ⇒ job record mang id default', async () => {
    const job = run('runner-da-bi-xoa')
    // Lúc submit, job vẫn mang id đã yêu cầu — đó là hành vi cũ và không đổi.
    expect(job.runnerId).toBe('runner-da-bi-xoa')

    const done = await settle(job.id)
    expect(done.status).toBe('succeeded')
    // Sau khi chạy, record phải nêu runner THẬT, không phải id đã yêu cầu.
    expect(done.runnerId).toBe(DEFAULT_RUNNER)
  })

  test('TC-D27: pin trỏ runner còn sống ⇒ writeback 🚫 không đổi giá trị đã đúng', async () => {
    const job = run(PINNED_RUNNER)
    const done = await settle(job.id)
    expect(done.status).toBe('succeeded')
    expect(done.runnerId).toBe(PINNED_RUNNER)
  })
})

describe('runJob — thông điệp lỗi phân biệt được hai ca hỏng', () => {
  test('TC-D13: job không pin, default đang TẮT ⇒ failed, lý do nêu id + reason', async () => {
    upsertRunner({ id: DEFAULT_RUNNER, connectionId: `conn-${DEFAULT_RUNNER}`, enabled: false, config: {} })

    const done = await settle(run().id)
    expect(done.status).toBe('failed')
    // Tiền tố nguyên văn — FE và log đang khớp chuỗi này.
    expect(done.error?.startsWith('runner not found or disabled')).toBe(true)
    expect(done.error).toContain(DEFAULT_RUNNER)
    expect(done.error).toContain('disabled')
  })

  test('TC-D28: pin trỏ runner tồn tại nhưng đã TẮT ⇒ failed, lý do nói rõ runner bị tắt', async () => {
    upsertRunner({ id: PINNED_RUNNER, connectionId: `conn-${PINNED_RUNNER}`, enabled: false, config: {} })

    const done = await settle(run(PINNED_RUNNER).id)
    expect(done.status).toBe('failed')
    expect(done.error?.startsWith('runner not found or disabled')).toBe(true)
    expect(done.error).toContain(`runner "${PINNED_RUNNER}" đang bị tắt`)
    // 🚫 Không lẫn với ca default hỏng của TC-D13.
    expect(done.error).not.toContain('runner mặc định')
  })
})
