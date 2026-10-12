import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { capturePage } from './_capture'

/**
 * Ted0cf9ac TC-40 — capture panel chat của nút điều phối khi chạy song song:
 *
 *   (a) nút điều phối đang bận ⇒ panel hiện text gợi ý riêng, vẫn cho gửi;
 *   (b) gửi khi bận ⇒ `201 { queued: true }`, tin nhắn hiện ở trạng thái chờ.
 *
 * Không có agent LLM thật: "step đang chạy" và "nút điều phối đang bận" được dựng
 * bằng job record `running` ghi thẳng vào home runtime của server e2e — đúng thứ
 * `hasActiveOrchestratorJob` và `getTaskChatState` đọc.
 */

const TASK_ID = 'ORCH-PAR-E2E'
const HERE = fileURLToPath(new URL('.', import.meta.url))
const FIXTURE_ROOT = path.join(HERE, 'fixtures/project/.dev-team-agent')
const TASK_DIR = path.join(FIXTURE_ROOT, 'tasks', TASK_ID)
const STATE_FILE = path.join(FIXTURE_ROOT, '.dev-state', `${TASK_ID}.json`)
const JOBS_DIR = path.resolve(process.cwd(), 'test-e2e/.runtime/home/jobs')
const STEP_JOB = 'e2e0cf9a-0001-4aaa-bbbb-cccccccccccc'
const ORCH_JOB = 'e2e0cf9a-0002-4aaa-bbbb-cccccccccccc'

const PIPELINE_YAML = [
  'version: 1',
  'steps_replace: true',
  'orchestrator:',
  '  enabled: true',
  '  agent: "e2e:orchestrator"',
  'steps:',
  '  - id: investigator',
  '    name: Investigate',
  '    agent: "e2e:investigator"',
  '  - id: designer',
  '    name: Design',
  '    agent: "e2e:designer"',
  '',
].join('\n')

async function writeJob(id: string, metadata: Record<string, unknown>) {
  await fs.mkdir(JOBS_DIR, { recursive: true })
  const now = new Date().toISOString()
  await fs.writeFile(
    path.join(JOBS_DIR, `${id}.json`),
    JSON.stringify({
      id,
      status: 'running',
      runnerId: 'e2e-runner',
      agentRef: 'e2e:agent',
      workspace: TASK_DIR,
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      exitCode: null,
      pid: null,
      metadata: { devTeamRoot: FIXTURE_ROOT, taskId: TASK_ID, ...metadata },
    }),
    'utf8',
  )
}

async function seed(): Promise<void> {
  await fs.mkdir(TASK_DIR, { recursive: true })
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
  await fs.writeFile(path.join(TASK_DIR, 'request.md'), `# ${TASK_ID}\n\nNút điều phối chạy song song.\n`, 'utf8')
  await fs.writeFile(path.join(TASK_DIR, 'pipeline.yaml'), PIPELINE_YAML, 'utf8')
  await fs.writeFile(
    STATE_FILE,
    JSON.stringify(
      { task_id: TASK_ID, current_phase: 'investigator', hitl_pending: null, orchestrator_enabled: true },
      null,
      2,
    ),
    'utf8',
  )
  // Step đang chạy + nút điều phối đang bận với một lượt của chính nó.
  await writeJob(STEP_JOB, { pipelineStepId: 'investigator', orchestratorDispatch: true })
  await writeJob(ORCH_JOB, { orchestratorJob: true, orchestratorTrigger: 'step_finished', stepId: '__orchestrator__' })
}

async function cleanup(): Promise<void> {
  await fs.rm(TASK_DIR, { recursive: true, force: true })
  await fs.rm(STATE_FILE, { force: true })
  for (const id of [STEP_JOB, ORCH_JOB]) {
    await fs.rm(path.join(JOBS_DIR, `${id}.json`), { force: true })
    await fs.rm(path.join(JOBS_DIR, `${id}.log`), { force: true })
  }
}

async function readState(): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'))
}

async function openOrchestratorChat(page: Page) {
  await page.goto('/')
  const row = page.locator('.task-row', { hasText: TASK_ID })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()
  const node = page.locator('.pnode.pnode-orchestrator').first()
  await expect(node).toBeVisible({ timeout: 15_000 })
  // Node điều phối nằm trên hàng step — kéo canvas xuống để hàng nút của nó vào khung nhìn.
  const pane = page.locator('.vue-flow__pane').first()
  const box = await pane.boundingBox()
  if (!box) throw new Error('không tìm thấy canvas')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 140, { steps: 10 })
  await page.mouse.up()
  await node.locator('.pnode-chat-btn').click()
  const win = page.locator('.nl-chat-window')
  await expect(win).toBeVisible()
  return win
}

test.beforeEach(seed)
test.afterAll(cleanup)

test('TC-40 (a) nút điều phối bận ⇒ panel hiện text gợi ý riêng, vẫn cho gửi (capture)', async ({ page }, testInfo) => {
  const win = await openOrchestratorChat(page)
  const input = win.locator('textarea')
  await expect(input).toHaveAttribute('placeholder', /Nút điều phối đang xử lý|orchestrator is busy/, {
    timeout: 15_000,
  })
  await expect(input).toBeEnabled()
  await capturePage(page, testInfo, 'orchestrator-parallel-busy-hint')
})

test('TC-40 (b) gửi khi bận ⇒ tin nhắn hiện ở trạng thái chờ, không lỗi 409 (capture)', async ({ page }, testInfo) => {
  const win = await openOrchestratorChat(page)
  const input = win.locator('textarea')
  await expect(input).toHaveAttribute('placeholder', /Nút điều phối đang xử lý|orchestrator is busy/, {
    timeout: 15_000,
  })

  const sent = page.waitForResponse(
    (r) => r.url().includes(`/api/tasks/${TASK_ID}/feedback`) && r.request().method() === 'POST',
  )
  await input.fill('M1-e2e: tình hình thế nào?')
  await win.locator('.nl-chat-send').click()
  const res = await sent
  expect(res.status()).toBe(201)
  expect(await res.json()).toEqual({ queued: true })

  await expect(win.locator('.is-pending', { hasText: 'M1-e2e' })).toBeVisible()
  await expect(win.locator('.nl-chat-error')).toHaveCount(0)
  expect((await readState()).pending_orchestrator_chat?.messages).toEqual(['M1-e2e: tình hình thế nào?'])
  await capturePage(page, testInfo, 'orchestrator-parallel-queued-message')
})
