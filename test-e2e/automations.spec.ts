import { test, expect } from '@playwright/test'
import { capturePage } from './_capture'

// E2E smoke cho mode Tự động hoá (#233) — tính năng lớn nhất của 1.1.0.
// Boot standalone server theo playwright.config (fixture .dev-team-agent +
// DEV_TEAM_DASHBOARD_HOME isolate). Rule được seed qua API `request` thay vì
// ghi file YAML tay: đúng đường người dùng đi, và dọn lại được ở cuối.
//
// Không chạy "Chạy thử ngay" trong e2e: action gọi task/HTTP/shell thật nên sẽ
// chậm và flaky. Việc chạy chuỗi action đã được phủ ở tầng business
// (tests/src/server/automations/runAction.test.ts).

/** Xa trong tương lai — scheduler của server thật không được kích hoạt rule này. */
const FUTURE_START = '2030-01-01T00:00:00.000Z'

const RULE_NAME = 'E2E smoke rule'

test('automations mode: danh sách rule + dialog tạo rule (capture)', async ({ page, request }, testInfo) => {
  const projectsRes = await request.get('/api/projects')
  const projectsBody = (await projectsRes.json()) as { defaultId?: string | null }
  const projectId = projectsBody.defaultId || ''
  const q = projectId ? `?project=${encodeURIComponent(projectId)}` : ''

  // Rule cùng tên còn sót lại (lần chạy trước timeout giữa chừng, cleanup không
  // kịp) sẽ làm `toHaveCount(1)` bên dưới thấy 2 dòng — dọn trước cho idempotent.
  const listed = await request.get(`/api/automations${q}`)
  const before = (await listed.json()) as { automations: Array<{ id: string; name: string }> }
  for (const stale of before.automations.filter((a) => a.name === RULE_NAME)) {
    await request.delete(`/api/automations/${stale.id}${q}`)
  }

  const created = await request.post(`/api/automations${q}`, {
    data: {
      name: RULE_NAME,
      description: 'Rule do e2e seed — sẽ bị xoá ở cuối test',
      enabled: true,
      triggers: [{ kind: 'timer', startAt: FUTURE_START, repeat: { mode: 'once' } }],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'không bao giờ chạy trong e2e' }],
    },
  })
  expect(created.status()).toBe(201)
  const ruleId = ((await created.json()) as { automation: { id: string } }).automation.id

  try {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.locator('button[title="Automations"]').click()
    await expect(page.locator('.automations-panel')).toBeVisible({ timeout: 15_000 })

    // Rule vừa seed hiển thị đúng tên + badge trạng thái.
    const row = page.locator('.rule-row', { hasText: RULE_NAME })
    await expect(row).toHaveCount(1, { timeout: 10_000 })
    await expect(row.locator('.rule-name')).toHaveText(RULE_NAME)
    await expect(row.locator('.rule-status-chip').first()).toHaveText('Đang bật')
    // Các lối vào hành động phải có mặt (không bấm "Chạy thử ngay").
    for (const title of ['Tắt automation', 'Chạy thử ngay', 'Lịch sử chạy', 'Sửa automation', 'Xoá automation']) {
      await expect(row.locator(`button[title="${title}"]`)).toBeVisible()
    }

    // Tab lịch sử thực thi mở được (rule chưa chạy → danh sách rỗng).
    await page.locator('.panel-tab', { hasText: 'Lịch sử' }).click()
    await expect(page.locator('.history-toolbar')).toBeVisible()
    await page.locator('.panel-tab').first().click()
    await expect(page.locator('.rule-table')).toBeVisible()

    // Dialog tạo rule mở và đóng được.
    await page.locator('.automations-panel .btn-primary').click()
    const dialog = page.locator('.automation-form')
    await expect(dialog).toBeVisible()

    // Bước runTask có ô "Project đích" — áp cho cả mode create lẫn existing
    // (T0d57ff58), nên nó phải nằm ngoài nhánh v-if của mode.
    await dialog.getByRole('button', { name: /Thêm bước/ }).click()
    const targetProject = dialog.locator('input[aria-label="Project đích (tuỳ chọn)"]')
    await expect(targetProject).toBeVisible()
    // Mặc định trống = dùng project đang chọn.
    await expect(targetProject).toHaveValue('')
    // Chip mode là <label> bọc radio `display: none` — `check()` sẽ chờ radio
    // hiện ra tới hết timeout, phải click vào label.
    await dialog.locator('label.chip-select', { hasText: 'Chạy task có sẵn' }).first().click()
    await expect(dialog.locator('input[aria-label="Task ID"]')).toBeVisible()
    await expect(targetProject).toBeVisible()

    await capturePage(page, testInfo, 'automations')

    await dialog.locator('.modal-close').click()
    await expect(dialog).toHaveCount(0)
  } finally {
    // Dọn rule để fixture không rò state sang spec khác.
    const deleted = await request.delete(`/api/automations/${ruleId}${q}`)
    expect(deleted.status()).toBe(200)
  }
})
