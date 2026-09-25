import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { capturePage } from './_capture'

/**
 * TC-40 — capture ba kịch bản của `request.md` trên app thật:
 *
 *   ① pipeline có node điều phối vẫn start được, và dừng rồi chạy lại được;
 *   ② khung chat mở từ node là khung của CHÍNH node, không phải của step đầu;
 *   ③ bật/tắt checkbox rồi Lưu ⇒ trạng thái node được reset.
 *
 * Giới hạn có chủ ý: e2e không có agent LLM thật, nên "agent quyết định gì" nằm ở
 * suite backend. Thứ duy nhất chấm ở đây là **đường thoát trên UI** — đúng cái mà
 * bug gốc lấy đi ("UI chỉ hiển thị một nút dừng; bấm nút dừng thì hoàn toàn không
 * thể start lại").
 */

const TASK_ID = 'ORCH-E2E'
const FIXTURE_ROOT = path.join(
  fileURLToPath(new URL('.', import.meta.url)),
  'fixtures/project/.dev-team-agent',
)
const TASK_DIR = path.join(FIXTURE_ROOT, 'tasks', TASK_ID)
const STATE_FILE = path.join(FIXTURE_ROOT, '.dev-state', `${TASK_ID}.json`)

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
  '    produces: [investigate.md]',
  '  - id: designer',
  '    name: Design',
  '    agent: "e2e:designer"',
  '    produces: [design.md]',
  '',
].join('\n')

/**
 * Task dựng lúc chạy chứ không commit: spec này ghi thật vào state của nó (Stop /
 * Run), nên một fixture commit sẵn sẽ bị bẩn mỗi lần chạy bị giết giữa chừng.
 */
async function seedTask(state: Record<string, unknown> = {}): Promise<void> {
  await fs.mkdir(TASK_DIR, { recursive: true })
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
  await fs.writeFile(path.join(TASK_DIR, 'request.md'), `# ${TASK_ID}\n\nKiểm thử node điều phối.\n`, 'utf8')
  await fs.writeFile(path.join(TASK_DIR, 'pipeline.yaml'), PIPELINE_YAML, 'utf8')
  await fs.writeFile(
    STATE_FILE,
    JSON.stringify(
      {
        task_id: TASK_ID,
        current_phase: 'investigator',
        hitl_pending: null,
        review_round: 0,
        auto_review: false,
        orchestrator_enabled: true,
        ...state,
      },
      null,
      2,
    ),
    'utf8',
  )
}

async function readState(): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'))
}

async function openTask(page: Page) {
  await page.goto('/')
  // ⚠️ Không dùng waitForLoadState('networkidle') — SSE task/job list (#348)
  // giữ kết nối mở vô thời hạn nên network không bao giờ "idle", chờ nó luôn
  // timeout dù trang đã render xong. Locator wait bên dưới (`.click()` /
  // `toBeVisible()` / …) tự chờ phần tử actionable, không cần networkidle.
  const row = page.locator('.task-row', { hasText: TASK_ID })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()
}

/** Node điều phối trên canvas monitor. */
function orchestratorNode(page: Page) {
  return page.locator('.pnode.pnode-orchestrator').first()
}

/**
 * Kéo canvas xuống — node điều phối nằm phía TRÊN hàng step, nên ở khung nhìn
 * mặc định hàng nút của nó rơi ra ngoài mép canvas. Kéo là thao tác người dùng
 * thật; phần "không kéo thì có chạm được không" là một case riêng bên dưới.
 */
async function panCanvasDown(page: Page, dy = 140) {
  const pane = page.locator('.vue-flow__pane').first()
  const box = await pane.boundingBox()
  if (!box) throw new Error('không tìm thấy canvas')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + dy, { steps: 10 })
  await page.mouse.up()
}

test.beforeEach(async () => {
  await seedTask()
})

test.afterAll(async () => {
  await fs.rm(TASK_DIR, { recursive: true, force: true })
  await fs.rm(STATE_FILE, { force: true })
})

// ① — trước khi bấm gì, trên màn hình phải TỒN TẠI một control start khả dụng.
// 🚫 Không phải cảnh "chỉ có mỗi nút dừng".
test('① node điều phối hiện nút chạy, không phải chỉ có nút dừng (capture)', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await openTask(page)

  const node = orchestratorNode(page)
  await expect(node).toBeVisible({ timeout: 15_000 })
  await expect(node.locator('.pnode-run-btn')).toBeVisible()
  await expect(node.locator('.pnode-stop-btn')).toHaveCount(0)
  await expect(node.locator('.pnode-chat-btn')).toBeVisible()
  await capturePage(page, testInfo, 'orchestrator-node-idle')

  expect(errors).toEqual([])
})

// ① (tiếp) — triệu chứng "bấm dừng thì hoàn toàn không thể start lại".
test('① đã dừng ⇒ vẫn còn đường chạy lại (capture)', async ({ page }, testInfo) => {
  await seedTask({ orchestrator_halted: true })
  await openTask(page)

  const node = orchestratorNode(page)
  await expect(node).toBeVisible({ timeout: 15_000 })
  await expect(node.locator('.pnode-run-btn')).toBeVisible()
  await capturePage(page, testInfo, 'orchestrator-node-halted')
})

// TC-03 Edge — "node bị che một phần ⇒ control vẫn chạm được (không bị cắt mất
// nút duy nhất)". Ở khung nhìn MẶC ĐỊNH, không kéo canvas: đây là màn hình đầu
// tiên người dùng thấy sau khi bật checkbox, nên nút duy nhất của node phải bấm
// được ngay tại đó.
test('TC-03 Edge — nút của node chạm được ngay ở khung nhìn mặc định', async ({ page }) => {
  await openTask(page)
  await expect(orchestratorNode(page)).toBeVisible({ timeout: 15_000 })

  const covering = await page.evaluate(() => {
    const btn = document.querySelector('.pnode-orchestrator .pnode-run-btn') as HTMLElement | null
    if (!btn) return 'không có nút Run'
    const r = btn.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null
    if (!hit) return 'điểm bấm nằm ngoài khung nhìn'
    return btn.contains(hit) || hit.contains(btn) ? null : `${hit.tagName}.${hit.className}`
  })
  expect(covering, 'phần tử nhận cú bấm tại tâm nút Run').toBeNull()
})

// ① đầy-đủ — bấm Run trên node thật sự giao được một lượt, và sau đó node vẫn
// còn đường thao tác.
//
// ⚠️ E2E không có runner AI: lượt vừa giao chắc chắn hỏng, và theo thiết kế thì
// điều phối tự dừng kèm lý do. Vì vậy case này KHÔNG chấm `orchestrator_halted`
// giữ nguyên `false` — nó chấm đúng hai thứ đề bài đòi: lượt được giao (phản hồi
// đọc được trên màn hình) và 🚫 không rơi vào ngõ cụt (TC-34).
test('① bấm Run giao được lượt và không rơi vào ngõ cụt (capture)', async ({ page }, testInfo) => {
  await openTask(page)
  await expect(orchestratorNode(page)).toBeVisible({ timeout: 15_000 })
  await panCanvasDown(page)

  await orchestratorNode(page).locator('.pnode-run-btn').click()

  // Phản hồi tường minh trên màn hình — 🚫 không phải im lặng.
  await expect(page.locator('.pipeline-toolbar .chip')).toBeVisible({ timeout: 15_000 })
  await capturePage(page, testInfo, 'orchestrator-node-running')

  // Sau lượt đó, node vẫn phải có ít nhất một control — đây là vế thứ hai của
  // triệu chứng ① ("bấm dừng thì hoàn toàn không thể start lại").
  await expect
    .poll(
      async () =>
        (await orchestratorNode(page).locator('.pnode-run-btn').count()) +
        (await orchestratorNode(page).locator('.pnode-stop-btn').count()),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0)
})

// ① (tiếp) — nút Stop ghi được trạng thái dừng, và sau đó Run hiện lại.
test('① Stop ghi trạng thái dừng, Run hiện lại ngay sau đó', async ({ page }) => {
  await openTask(page)
  await expect(orchestratorNode(page)).toBeVisible({ timeout: 15_000 })
  await panCanvasDown(page)

  // Ép node vào trạng thái "đang bận" bằng cách cho một lượt chạy: sau khi bấm
  // Run, node đổi sang Stop trong lúc lượt còn sống.
  await orchestratorNode(page).locator('.pnode-run-btn').click()
  await expect(page.locator('.pipeline-toolbar .chip')).toBeVisible({ timeout: 15_000 })

  await expect.poll(async () => 'orchestrator_halted' in (await readState()), { timeout: 15_000 }).toBe(true)
  await expect(orchestratorNode(page).locator('.pnode-run-btn, .pnode-stop-btn')).toHaveCount(1)
})

// ② — khung chat mở từ node phải là khung của node, không phải của step đầu.
test('② khung chat mở từ node là khung của chính node (capture)', async ({ page }, testInfo) => {
  await openTask(page)
  await expect(orchestratorNode(page)).toBeVisible({ timeout: 15_000 })
  await panCanvasDown(page)

  await orchestratorNode(page).locator('.pnode-chat-btn').click()

  const win = page.locator('.nl-chat-window')
  await expect(win).toBeVisible()
  const title = win.locator('.nl-chat-title')
  await expect(title).toContainText(TASK_ID)
  // Tiêu đề mang nhãn của node điều phối, 🚫 không phải tên step đầu.
  await expect(title).not.toContainText('Investigate')
  await capturePage(page, testInfo, 'orchestrator-node-chat')
})

// ③ — bật/tắt checkbox rồi Lưu là cách reset trạng thái node.
test('③ tắt rồi bật lại checkbox + Lưu ⇒ trạng thái node được reset (capture)', async ({
  page,
}, testInfo) => {
  await seedTask({ orchestrator_halted: true })

  await page.goto('/')
  // ⚠️ Không dùng waitForLoadState('networkidle') — SSE task/job list (#348)
  // giữ kết nối mở vô thời hạn nên network không bao giờ "idle", chờ nó luôn
  // timeout dù trang đã render xong. Locator wait bên dưới (`.click()` /
  // `toBeVisible()` / …) tự chờ phần tử actionable, không cần networkidle.
  await page.getByRole('button', { name: 'Pipeline Editor' }).click()
  await expect(page.locator('.vue-flow')).toBeVisible({ timeout: 15_000 })

  // Tab Task ↔ scope `task` — checkbox điều phối của đề bài là của pipeline TASK.
  await page.locator('.editor-root .c-screen-layout__tab', { hasText: 'Task' }).click()

  const targetPanel = page.locator('.editor-target-panel')
  await expect(targetPanel).toBeVisible()

  // CSelect là dropdown tự vẽ (không phải <select> gốc): mở rồi chọn theo nhãn.
  await targetPanel.locator('#editor-target-task .c-select-trigger').click()
  await targetPanel.locator('.c-select-option', { hasText: TASK_ID }).click()

  const checkbox = targetPanel.locator('.target-check input[type="checkbox"]')
  await expect(checkbox).toBeVisible()
  await expect(checkbox).toBeChecked()
  await capturePage(page, testInfo, 'orchestrator-checkbox')

  await checkbox.uncheck()
  await checkbox.check()
  await targetPanel.locator('.target-actions .icon-btn').first().click()

  await expect.poll(async () => (await readState()).orchestrator_halted, { timeout: 15_000 }).toBe(false)
})
