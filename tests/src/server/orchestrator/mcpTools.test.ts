import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createOrchestratorMcpServer } from '../../../../src/features/orchestrator/business/mcpTools.js'
import type { TaskRef } from '../../../../src/features/orchestrator/business/decisionLoop.js'
import { listJobs, loadJob, registerProvider, upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index.js'
import type { ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

/*
 * Bug A — kênh ra lệnh trực tiếp (`test-spec.md` TC-01…TC-08, TC-11). Gọi tool
 * qua ĐÚNG giao thức MCP (Client + InMemoryTransport của chính SDK), không đọc
 * hàm nội bộ của `mcpTools.ts` — đây là bề mặt mà agent CLI thấy khi gọi
 * `orchestrator_status` / `orchestrator_read_output` / `orchestrator_decide`
 * GIỮA lượt, không đợi job của chính nó kết thúc.
 *
 * Xác thực token (TC-09/TC-10) chấm riêng ở
 * `tests/src/server/http/mcpOrchestrator.route.test.ts` — route đó dùng đúng
 * `createOrchestratorMcpServer` này sau khi đã qua cổng token.
 */

const PROVIDER_ID = 'stub-mcp-tools'
const RUNNER_ID = 'stub-runner-mcp-tools'

let home: string
let root: string
const savedEnv = { ...process.env }

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(): Promise<ExecuteResult> {
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

function writePipeline() {
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      'orchestrator: { enabled: true, agent: "a:orch" }',
      'steps:',
      '  - { id: implementer, name: Implement, agent: " " }',
      '  - { id: reviewer, name: Review, agent: " " }',
    ].join('\n'),
    'utf8',
  )
}

function seedTask(taskId: string, state: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), '# yêu cầu\n', 'utf8')
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: 'implementer', orchestrator_enabled: true, ...state }),
    'utf8',
  )
}

function stateOf(taskId: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, '.dev-state', `${taskId}.json`), 'utf8'))
}

/** Ghi thẳng một job record — mô phỏng "step khác đang chạy" mà orchestrator hỏi tới giữa lượt. */
function writeJob(id: string, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const dir = path.join(home, 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      status: 'running',
      runnerId: 'r',
      agentRef: 'a',
      workspace: path.join(root, 'tasks', String(metadata.taskId ?? 'T')),
      createdAt: new Date().toISOString(),
      metadata: { devTeamRoot: root, ...metadata },
      ...extra,
    }),
    'utf8',
  )
  return id
}

function writeJobLog(id: string, text: string) {
  fs.mkdirSync(path.join(home, 'jobs'), { recursive: true })
  fs.writeFileSync(path.join(home, 'jobs', `${id}.log`), text, 'utf8')
}

/** Nối một Client thật (SDK) vào server MCP của `ref` — đúng đường agent CLI đi qua. */
async function connectClient(ref: TaskRef): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createOrchestratorMcpServer(ref)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-orchestrator-agent', version: '1.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return {
    client,
    close: async () => {
      await client.close().catch(() => {})
      await server.close().catch(() => {})
    },
  }
}

function textOf(result: any): string {
  return result.content?.[0]?.text ?? ''
}

function refOf(taskId: string): TaskRef {
  return { taskId, root, projectId: '' }
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-tools-home-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-mcp-tools', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' } as any)
  upsertRunner({ id: RUNNER_ID, connectionId: 'stub-conn-mcp-tools', config: {} } as any)
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-tools-root-'))
  writePipeline()
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('orchestrator_status — TC-01/TC-02', () => {
  test('TC-01: step khác đang chạy ⇒ phản ánh đúng NGAY, không cache/rỗng', async () => {
    seedTask('T1')
    writeJob('j1', { taskId: 'T1', pipelineStepId: 'implementer' }, { status: 'running' })
    const { client, close } = await connectClient(refOf('T1'))
    try {
      const res = await client.callTool({ name: 'orchestrator_status', arguments: {} })
      const body = JSON.parse(textOf(res))
      expect(body.activeStep).toMatchObject({ stepId: 'implementer', status: 'running', jobId: 'j1' })
    } finally {
      await close()
    }
  })

  test('TC-02: không step nào đang chạy ⇒ activeStep null, không throw/không giả trạng thái cũ', async () => {
    seedTask('T2')
    const { client, close } = await connectClient(refOf('T2'))
    try {
      const res = await client.callTool({ name: 'orchestrator_status', arguments: {} })
      expect(res.isError).not.toBe(true)
      const body = JSON.parse(textOf(res))
      expect(body.activeStep).toBeNull()
      expect(body.currentPhase).toBe('implementer')
    } finally {
      await close()
    }
  })
})

describe('orchestrator_read_output — TC-03/TC-04', () => {
  const JOB_T3 = 'aaaaaaaa-0003-4ccc-dddd-eeeeeeeeeeee'
  const JOB_T4 = 'aaaaaaaa-0004-4ccc-dddd-eeeeeeeeeeee'

  test('TC-03: job đang chạy đã có output ⇒ đọc được ngay, không đợi finished', async () => {
    seedTask('T3')
    writeJob(JOB_T3, { taskId: 'T3', pipelineStepId: 'implementer' }, { status: 'running' })
    writeJobLog(JOB_T3, 'đang chạy dở...\n')
    const { client, close } = await connectClient(refOf('T3'))
    try {
      const res = await client.callTool({ name: 'orchestrator_read_output', arguments: { offset: 0 } })
      const body = JSON.parse(textOf(res))
      expect(body.text).toContain('đang chạy dở')
      expect(body.eof).toBe(false)
    } finally {
      await close()
    }
  })

  test('TC-04: job vừa dispatch, chưa có output ⇒ rỗng, không lỗi/không treo', async () => {
    seedTask('T4')
    writeJob(JOB_T4, { taskId: 'T4', pipelineStepId: 'implementer' }, { status: 'running' })
    const { client, close } = await connectClient(refOf('T4'))
    try {
      const res = await client.callTool({ name: 'orchestrator_read_output', arguments: {} })
      expect(res.isError).not.toBe(true)
      const body = JSON.parse(textOf(res))
      expect(body.text).toBe('')
    } finally {
      await close()
    }
  })
})

describe('TC-08 — kênh chỉ tác động đúng task/root của chính orchestrator gọi nó', () => {
  test('taskId trùng tên ở root khác ⇒ không lộ trạng thái/output chéo', async () => {
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-tools-other-'))
    try {
      const JOB_OTHER = 'aaaaaaaa-0000-4ccc-dddd-eeeeeeeeeeee'
      seedTask('SAME')
      writeJob(
        JOB_OTHER,
        { taskId: 'SAME', pipelineStepId: 'implementer', devTeamRoot: otherRoot },
        { status: 'running' },
      )
      writeJobLog(JOB_OTHER, 'bí mật của root khác')

      const { client, close } = await connectClient(refOf('SAME'))
      try {
        const status = JSON.parse(textOf(await client.callTool({ name: 'orchestrator_status', arguments: {} })))
        expect(status.activeStep).toBeNull()

        const out = JSON.parse(textOf(await client.callTool({ name: 'orchestrator_read_output', arguments: {} })))
        expect(out.text).toBe('')
        expect(out.eof).toBe(true)
      } finally {
        await close()
      }
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true })
    }
  })
})

describe('orchestrator_decide — TC-06/TC-07', () => {
  test('TC-06: stepId không có trong pipeline ⇒ từ chối rõ ràng, không dispatch/không side-effect', async () => {
    seedTask('T6')
    const { client, close } = await connectClient(refOf('T6'))
    try {
      const res = await client.callTool({ name: 'orchestrator_decide', arguments: { action: 'start', stepId: 'khong-co' } })
      expect(res.isError).toBe(true)
      expect(textOf(res)).toContain('unknown stepId')
      expect(listJobs(200).filter((j) => j.metadata?.taskId === 'T6')).toHaveLength(0)
      expect(stateOf('T6').current_phase).toBe('implementer')
    } finally {
      await close()
    }
  })

  test('TC-07: halt ⇒ có hiệu lực ngay, quan sát được qua state ngay sau (không đợi lượt kết thúc)', async () => {
    seedTask('T7')
    const { client, close } = await connectClient(refOf('T7'))
    try {
      const res = await client.callTool({ name: 'orchestrator_decide', arguments: { action: 'halt', reason: 'test' } })
      expect(JSON.parse(textOf(res))).toEqual({ applied: 'halt' })
      expect(stateOf('T7').orchestrator_halted).toBe(true)
    } finally {
      await close()
    }
  })
})

describe('orchestrator_decide — TC-05 start có hiệu lực ngay, giữa lượt', () => {
  test('sau khi gọi start, step chỉ định thực sự được dispatch — không cần đợi lượt orchestrator kết thúc', async () => {
    seedTask('T5')
    const { client, close } = await connectClient(refOf('T5'))
    try {
      const decide = await client.callTool({ name: 'orchestrator_decide', arguments: { action: 'start', stepId: 'implementer' } })
      expect(JSON.parse(textOf(decide))).toEqual({ applied: 'start' })

      const jobs = listJobs(200).filter(
        (j) => j.metadata?.taskId === 'T5' && j.metadata?.pipelineStepId === 'implementer',
      )
      expect(jobs.length).toBeGreaterThan(0)
    } finally {
      await close()
    }
  })

  test('TC-08 (vế start): stepId hợp lệ NHƯNG không có tham số nào cho phép trỏ tới task khác', async () => {
    // Bất biến thiết kế: `orchestrator_decide` không nhận `taskId`/`root` từ agent
    // — `ref` bị đóng cứng qua closure lúc mint token. Ở đây chỉ xác nhận: gọi
    // action `start` không có cách nào truyền taskId khác đi kèm và có tác dụng.
    seedTask('T5b')
    const { client, close } = await connectClient(refOf('T5b'))
    try {
      // `arguments` của MCP tool call là JSON tự do (không gõ kiểu chặt phía
      // client) — cố ý gửi field lạ `taskId`/`root` để xác nhận chúng bị bỏ
      // qua, không có cách nào trỏ sang task khác qua kênh này.
      const res = await client.callTool({
        name: 'orchestrator_decide',
        arguments: { action: 'start', stepId: 'implementer', taskId: 'khong-lien-quan', root: '/khong/ton/tai' },
      })
      expect(res.isError).not.toBe(true)
      // Job dispatch đi đúng vào T5b — và taskId lạ gửi kèm không tạo ra job nào của riêng nó.
      expect(
        listJobs(200).some((j) => j.metadata?.taskId === 'T5b' && j.metadata?.pipelineStepId === 'implementer'),
      ).toBe(true)
      expect(listJobs(200).some((j) => j.metadata?.taskId === 'khong-lien-quan')).toBe(false)
    } finally {
      await close()
    }
  })
})

describe('orchestrator_decide — TC-11 chống double-dispatch với sentinel cùng lượt', () => {
  test('đánh dấu job orchestrator hiện tại đã áp dụng quyết định qua tool (chặn đọc lại sentinel)', async () => {
    seedTask('T11')
    const jobId = writeJob(
      'j11-orch',
      { taskId: 'T11', orchestratorJob: true, orchestratorTrigger: 'step_finished' },
      { status: 'running' },
    )
    const { client, close } = await connectClient(refOf('T11'))
    try {
      await client.callTool({ name: 'orchestrator_decide', arguments: { action: 'start', stepId: 'reviewer' } })
      const job = loadJob(jobId)
      // G4 — đây là cơ chế thật chặn `consumeAgentDecision` áp dụng LẦN NỮA sentinel
      // cuối output của CÙNG job này khi `job.finished` tới (xem decisionLoop.test.ts TC-11).
      expect(job?.metadata?.mcpDecisionApplied).toBe(true)
    } finally {
      await close()
    }
  })
})
