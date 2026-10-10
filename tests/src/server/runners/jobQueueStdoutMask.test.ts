import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadJob,
  registerProvider,
  submitApprovalJob,
  submitJob,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import { parseOrchestratorDecision } from '../../../../src/features/runner/business/jobQueue.js'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { SecretMasker } from '../../../../src/features/mcp/business/SecretMasker.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

/**
 * TC-SEC-51…TC-SEC-58 — mask ở BIÊN PERSIST (#385 SEC-12 / SEC-13, PR 1).
 *
 * Bề mặt: `JobRecord` trên đĩa (`jobs/<id>.json`), `metadata.stepSummary`,
 * `GET /api/jobs`, và nội dung artifact scratch của job approval.
 *
 * 📌 Hai đường tách hẳn nhau và cả hai đều phải được khoá, 🚫 assert một rồi suy:
 *   - **đường ghi đĩa / API** đọc `maskedStdout ?? stdout` ⇒ đã mask;
 *   - **đường chức năng** (`foldProposalIntoScratch`, `parseOrchestratorDecision`)
 *     đọc `stdout` THÔ — mask là split/join mù, nó cắt giữa artifact.
 *
 * Provider là stub: thứ đang chấm là `jobQueue`, 🚫 phải cách một CLI sinh ra
 * `maskedStdout`. Ca sinh `maskedStdout` THẬT nằm ở `claude-code-cli.test.ts`.
 */

const CANARY = 'sk-test-LEAKCANARY-0123456789'
const CHAT_STDOUT_LIMIT = 64 * 1024

/** Kết quả mà stub provider sẽ trả ở lượt chạy kế tiếp. */
let nextResult: Partial<ExecuteResult> = {}
const capturedWorkspaces: string[] = []

const stubProvider: RunnerProvider = {
  providerId: 'stub-stdout-mask',
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    capturedWorkspaces.push(req.workspace)
    return { ok: true, exitCode: 0, durationMs: 1, ...nextResult }
  },
}

let home: string
let app: Awaited<ReturnType<typeof createApp>>
const savedEnv = { ...process.env }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function settle(id: string) {
  for (let i = 0; i < 600; i++) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled (status=${loadJob(id)?.status})`)
}

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: home,
    resolveProjectRoot: () => home,
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

/**
 * Job NL chat — `metadata.isNlChat` làm `shouldPersistStdout` trả `true` bất kể
 * provider, nên ca ở đây đo đúng `persistStdout` chứ 🚫 vướng bộ lọc theo họ provider.
 */
function nlChatJob(prompt = 'chạy thử') {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mask-ws-'))
  return submitJob({
    runnerId: 'stub-runner-mask',
    agentRef: '',
    workspace: ws,
    userPrompt: prompt,
    metadata: { isNlChat: true },
  })
}

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mask-home-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({
    id: 'stub-conn-mask',
    kind: 'local-console',
    providerId: 'stub-stdout-mask',
    cliPath: 'stub',
  })
  upsertRunner({ id: 'stub-runner-mask', connectionId: 'stub-conn-mask', config: {} })
  app = await createApp(fakeCtx())
})

afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  nextResult = {}
  capturedWorkspaces.length = 0
})

describe('persistStdout — biên persist của JobRecord', () => {
  // TC-SEC-51 ⭐
  test('TC-SEC-51: có `maskedStdout` ⇒ JobRecord.stdout và stepSummary đều lấy bản ĐÃ MASK', async () => {
    const raw = `dòng đầu\n401 Unauthorized: Bearer ${CANARY}\nSTEP_SUMMARY: xong, token ${CANARY}`
    nextResult = { stdout: raw, maskedStdout: new SecretMasker([CANARY]).mask(raw) }

    const done = await settle(nlChatJob().id)

    expect(done.stdout).toBeTruthy()
    expect(done.stdout).not.toContain(CANARY)
    expect(done.stdout).toContain('***')
    expect(done.metadata?.stepSummary).toBeTruthy()
    expect(String(done.metadata?.stepSummary)).not.toContain(CANARY)
    // Vế phủ định quét TOÀN BỘ bản ghi, 🚫 chỉ một field.
    expect(JSON.stringify(done)).not.toContain(CANARY)
  })

  // TC-SEC-52 — 🚫 rơi về chuỗi rỗng khi 🚫 có bản mask.
  test('TC-SEC-52: 🚫 có `maskedStdout` ⇒ JobRecord.stdout = stdout THÔ, byte-identical', async () => {
    const raw = 'kết quả thường, 🚫 có secret nào\nSTEP_SUMMARY: ổn'
    nextResult = { stdout: raw }

    const done = await settle(nlChatJob().id)

    expect(done.stdout).toBe(raw)
    expect(done.stdout).not.toBe('')
    expect(done.metadata?.stepSummary).toBe('ổn')
  })

  // TC-SEC-53 ⭐ — thứ tự bắt buộc là MASK rồi mới CẮT.
  test('TC-SEC-53: stdout dài hơn limit, secret nằm SAU điểm cắt ⇒ cắt đúng limit và 🚫 canary', async () => {
    const filler = 'x'.repeat(CHAT_STDOUT_LIMIT + 10)
    const raw = `${filler}\n401 Unauthorized: Bearer ${CANARY}\n`
    expect(raw.length).toBeGreaterThan(CHAT_STDOUT_LIMIT)
    nextResult = { stdout: raw, maskedStdout: new SecretMasker([CANARY]).mask(raw) }

    const done = await settle(nlChatJob().id)

    expect(done.stdout).toHaveLength(CHAT_STDOUT_LIMIT)
    expect(done.stdout).not.toContain(CANARY)
    expect(JSON.stringify(done)).not.toContain(CANARY)
  })

  /**
   * TC-SEC-54 ⭐ — hai vế trong CÙNG một ca:
   *   (a) quyết định điều phối vẫn parse đúng khi đọc từ stdout **thô** — canary
   *       nằm trong chính `context` của dòng quyết định, nên nếu đường chức năng
   *       bị đổi sang bản mask thì giá trị đọc ra là `***` chứ 🚫 phải lệnh gốc;
   *   (b) `JobRecord.stdout` vẫn đã mask.
   *
   * 📌 Vế (a) chấm **hợp đồng của parser trên đúng giá trị mà `runJob` trao cho
   * nó** (`tryDispatchOrchestratorDecision(job, result.stdout)`), 🚫 phải dựng lại
   * cả vòng dispatch — vòng đó đã có suite riêng (`orchestratorChatDispatch.test.ts`).
   */
  test('TC-SEC-54: ORCHESTRATOR_DECISION parse từ stdout THÔ, bản ghi vẫn mask', async () => {
    // Secret CHỒNG LÊN chính `stepId` của dòng quyết định: đó là cách duy nhất
    // để bản mask tạo ra một lệnh KHÁC thay vì chỉ "mất một field parser 🚫 đọc".
    const stepId = 'implementer-sk-test-LEAKCANARY-0123456789'
    const decision = `ORCHESTRATOR_DECISION: {"action":"start","stepId":"${stepId}"}`
    const raw = `suy nghĩ…\n401 Unauthorized: Bearer ${CANARY}\n${decision}\n`
    const masked = new SecretMasker([CANARY]).mask(raw)
    nextResult = { stdout: raw, maskedStdout: masked }

    const done = await settle(nlChatJob().id)

    // (a) đường chức năng — đọc THÔ ⇒ lệnh nguyên vẹn.
    expect(parseOrchestratorDecision(raw)).toEqual({ action: 'start', stepId })
    // …và nếu đọc bản mask thì lệnh đã KHÁC — hai đường 🚫 thay nhau được.
    expect(parseOrchestratorDecision(masked)).not.toEqual({ action: 'start', stepId })
    expect(parseOrchestratorDecision(masked)?.stepId).toBe('implementer-***')

    // (b) đường ghi đĩa — đã mask.
    expect(done.stdout).not.toContain(CANARY)
    expect(done.stdout).toContain('***')
  })

  /**
   * TC-SEC-55 ⭐ — ca end-to-end THẬT cho đường chức năng: job approval ghép
   * stdout vào artifact scratch. File trên đĩa phải mang nội dung **nguyên vẹn**
   * (🚫 có `***` chen giữa artifact), còn bản ghi job vẫn đã mask.
   */
  test('TC-SEC-55: artifact ghép vào scratch nguyên vẹn, bản ghi job vẫn mask', async () => {
    const artifact = [
      '# Design',
      '',
      `Giá trị cấu hình: ${CANARY}`,
      '',
      '## Kết luận',
    ].join('\n')
    nextResult = {
      stdout: artifact,
      maskedStdout: new SecretMasker([CANARY]).mask(artifact),
      // Job approval 🚫 đi qua `isNlChat`; persist stdout ở đây 🚫 cần thiết cho ca.
    }

    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mask-appr-'))
    fs.writeFileSync(path.join(ws, 'design.md'), 'ban dau\n', 'utf8')
    const job = submitApprovalJob({
      runnerId: 'stub-runner-mask',
      agentRef: '',
      workspace: ws,
      userPrompt: 'đề xuất',
      approvalArtifact: 'design.md',
      metadata: { targetFile: 'design.md' },
    })
    const done = await settle(job.id)

    expect(done.status).toBe('awaiting_approval')
    const scratch = fs.readFileSync(path.join(done.workspace, 'design.md'), 'utf8')
    // Đường chức năng: NGUYÊN VẸN.
    expect(scratch).toContain(CANARY)
    expect(scratch).not.toContain('***')
    // Đường ghi đĩa: `stepSummary` (nếu có) và mọi field khác của bản ghi đã mask.
    expect(JSON.stringify({ ...done, workspace: '' })).not.toContain(CANARY)
    fs.rmSync(ws, { recursive: true, force: true })
  })

  /**
   * TC-SEC-56 — tiền lệ thật ghi trong #385: chuỗi trông-như-secret nhưng là
   * payload CHỨC NĂNG. 🚫 Có secret MCP nào ⇒ 🚫 có `maskedStdout` ⇒ 🚫 cắt sai.
   */
  test('TC-SEC-56: payload chức năng giống secret ⇒ 🚫 bị cắt sai', async () => {
    const raw = 'mcp: tools/list timed out after 200ms\nSTEP_SUMMARY: đã thử lại'
    nextResult = { stdout: raw }

    const done = await settle(nlChatJob().id)

    expect(done.stdout).toBe(raw)
    expect(done.stdout).toContain('timed out after 200ms')
    expect(done.stdout).not.toContain('***')
  })

  // TC-SEC-57
  test('TC-SEC-57: GET /api/jobs?id=<id> ⇒ body 🚫 chứa canary', async () => {
    const raw = `Bearer ${CANARY}\n`
    nextResult = { stdout: raw, maskedStdout: new SecretMasker([CANARY]).mask(raw) }
    const job = await settle(nlChatJob().id)

    const byQuery = await app.request(`/api/jobs?id=${job.id}`)
    const byPath = await app.request(`/api/jobs/${job.id}`)

    expect(byQuery.status).toBe(200)
    expect(await byQuery.text()).not.toContain(CANARY)
    expect(byPath.status).toBe(200)
    expect(await byPath.text()).not.toContain(CANARY)
    // Cả route danh sách.
    expect(await (await app.request('/api/jobs')).text()).not.toContain(CANARY)
  })

  /**
   * TC-SEC-58 — HAI chỗ persist khác nhau trong `runJob`, liệt kê từng chỗ:
   *   (1) nhánh `advancePipelineStepChain` … `finally` — job thành công, 🚫 chat-feedback;
   *   (2) `saveJob` cuối hàm — job THẤT BẠI (và mọi nhánh còn lại).
   * Assert một chỗ rồi suy ra chỗ kia đúng là thứ §2.3 cấm.
   */
  test('TC-SEC-58: cả hai chỗ persist (job xanh và job đỏ) đều mask', async () => {
    const raw = `Bearer ${CANARY}\n`
    const masked = new SecretMasker([CANARY]).mask(raw)

    // (1) job thành công.
    nextResult = { ok: true, stdout: raw, maskedStdout: masked }
    const okJob = await settle(nlChatJob('xanh').id)
    expect(okJob.status).toBe('succeeded')
    expect(okJob.stdout).not.toContain(CANARY)

    // (2) job thất bại — nhánh `saveJob` cuối hàm.
    nextResult = { ok: false, exitCode: 1, error: 'boom', stdout: raw, maskedStdout: masked }
    const failJob = await settle(nlChatJob('đỏ').id)
    expect(failJob.status).toBe('failed')
    expect(failJob.stdout).toBeTruthy()
    expect(failJob.stdout).not.toContain(CANARY)
    expect(JSON.stringify(failJob)).not.toContain(CANARY)
  })
})
