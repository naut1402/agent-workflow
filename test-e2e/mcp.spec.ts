import { test, expect, type Page } from '@playwright/test'
import { capturePage } from './_capture'

/**
 * TC-89…TC-94 — E2E cho tab MCP của màn Runner Config.
 *
 * Lớp xác nhận thứ hai cho AC-1 (khai báo được MCP server) và AC-2 (tab MCP đặt
 * NGAY SAU tab Runner). Ghi xuống `DEV_TEAM_DASHBOARD_HOME` cô lập của
 * `playwright.config.ts`, 🚫 không chạm `~/.dev-team-dashboard` thật.
 *
 * ⚠️ `test-e2e/runner.spec.ts` (TC-95) 🚫 KHÔNG được sửa một dòng nào: nó chờ
 * `.runner-config` rồi thao tác `.runner-list li`. Phải sửa nó mới xanh nghĩa là
 * ràng buộc thiết kế đã bị phá — báo lại, đừng sửa spec.
 */

const MCP_ID = 'e2e-mcp'
const MCP_LABEL = 'E2E MCP server'

/**
 * 🚫 Không `waitForLoadState('networkidle')`: dashboard giữ một stream SSE mở
 * suốt phiên nên "mạng rảnh" không bao giờ tới trên máy không có sẵn cache
 * browser. Chờ đúng phần tử cần thao tác là điều kiện đủ và ổn định hơn.
 */
async function openRunnerConfig(page: Page) {
  await page.goto('/')
  const entry = page.locator('button[title="Runner Config"]')
  await expect(entry).toBeVisible({ timeout: 30_000 })
  await entry.click()
  await expect(page.locator('.runner-config')).toBeVisible({ timeout: 15_000 })
}

async function openMcpTab(page: Page) {
  await page.getByRole('tab', { name: 'MCP', exact: true }).click()
  await expect(page.locator('.mcp-panel')).toBeVisible({ timeout: 10_000 })
}

/** Xoá server nếu còn sót từ lượt chạy trước — spec phải chạy lại được. */
async function removeIfPresent(page: Page, label: string) {
  const row = page.locator('.mcp-list li').filter({ hasText: label })
  if (!(await row.count())) return
  page.once('dialog', (d) => d.accept())
  await row.first().getByRole('button', { name: 'Xóa MCP server' }).click()
  await expect(row).toHaveCount(0, { timeout: 10_000 })
}

// TC-89 — AC-2
test('mcp: màn Runner Config có 2 tab, MCP đứng NGAY SAU Runner', async ({ page }) => {
  await openRunnerConfig(page)

  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(0)).toHaveText('Runner')
  await expect(tabs.nth(1)).toHaveText('MCP')
  // Tab mặc định vẫn là Runner — hồi quy cho `runner.spec.ts`.
  await expect(page.locator('.runner-config')).toBeVisible()
})

// TC-90 — AC-1
test('mcp: bấm tab MCP ⇒ hiện panel và nút thêm, ẩn .runner-config', async ({ page }) => {
  await openRunnerConfig(page)
  await openMcpTab(page)

  await expect(page.getByRole('button', { name: '+ Thêm MCP server' })).toBeVisible()
  await expect(page.locator('.runner-config')).toHaveCount(0)
})

// TC-91 / TC-92 / TC-94 — khai báo đầu-cuối, sửa, xoá, capture.
test('mcp: khai báo stdio đầu-cuối, persist sau reload, sửa rồi xoá (capture)', async ({ page }, testInfo) => {
  await openRunnerConfig(page)
  await capturePage(page, testInfo, 'runner-config-tab-runner')
  await openMcpTab(page)
  await removeIfPresent(page, MCP_LABEL)
  await removeIfPresent(page, `${MCP_LABEL} v2`)

  // TC-91: điền dialog rồi Lưu.
  await page.getByRole('button', { name: '+ Thêm MCP server' }).click()
  const dialog = page.getByRole('dialog', { name: 'Thêm MCP server' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('vd. playwright').fill(MCP_ID)
  await dialog.getByLabel('Tên hiển thị').fill(MCP_LABEL)
  await dialog.getByLabel('Command').fill('npx')
  await dialog.locator('textarea').fill('-y\n@playwright/mcp@latest')
  await page.getByRole('button', { name: 'Lưu MCP server' }).click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })

  const row = page.locator('.mcp-list li').filter({ hasText: MCP_LABEL })
  await expect(row).toHaveCount(1)
  await expect(row.first()).toContainText('stdio')

  await capturePage(page, testInfo, 'runner-config-tab-mcp')

  // TC-91: reload ⇒ dòng vẫn còn (đã persist xuống store).
  await openRunnerConfig(page)
  await openMcpTab(page)
  await expect(page.locator('.mcp-list li').filter({ hasText: MCP_LABEL })).toHaveCount(1)

  // TC-92: sửa label.
  await page.locator('.mcp-list li').filter({ hasText: MCP_LABEL }).first().click()
  const editDialog = page.getByRole('dialog', { name: 'Sửa MCP server' })
  await expect(editDialog).toBeVisible()
  await editDialog.getByLabel('Tên hiển thị').fill(`${MCP_LABEL} v2`)
  await page.getByRole('button', { name: 'Lưu MCP server' }).click()
  await expect(editDialog).toBeHidden({ timeout: 10_000 })
  await expect(page.locator('.mcp-list li').filter({ hasText: `${MCP_LABEL} v2` })).toHaveCount(1)

  // TC-92: xoá + xác nhận, rồi reload để chắc là đã xoá dưới store.
  await removeIfPresent(page, `${MCP_LABEL} v2`)
  await openRunnerConfig(page)
  await openMcpTab(page)
  await expect(page.locator('.mcp-list li').filter({ hasText: MCP_LABEL })).toHaveCount(0)
})

// TC-93 — AC-3: khai báo ở tab MCP dùng được cho job.
test('mcp: server vừa khai xuất hiện ở ConnectionDialog', async ({ page }) => {
  await openRunnerConfig(page)
  await openMcpTab(page)
  await removeIfPresent(page, MCP_LABEL)

  await page.getByRole('button', { name: '+ Thêm MCP server' }).click()
  const dialog = page.getByRole('dialog', { name: 'Thêm MCP server' })
  await dialog.getByPlaceholder('vd. playwright').fill(MCP_ID)
  await dialog.getByLabel('Tên hiển thị').fill(MCP_LABEL)
  await dialog.getByLabel('Command').fill('npx')
  await page.getByRole('button', { name: 'Lưu MCP server' }).click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })

  // Sang tab Runner ⇒ mở Connection dialog.
  await page.getByRole('tab', { name: 'Runner', exact: true }).click()
  await expect(page.locator('.runner-config')).toBeVisible()
  await page.getByRole('button', { name: '+ Thêm runner' }).click()
  const runnerDialog = page.getByRole('dialog', { name: 'Thêm runner' })
  await expect(runnerDialog).toBeVisible()
  await runnerDialog.getByRole('button', { name: 'Thêm connection' }).click()
  const connDialog = page.getByRole('dialog', { name: 'Thêm connection' })
  await expect(connDialog).toBeVisible()

  await expect(connDialog.getByText('MCP server', { exact: true })).toBeVisible()
  await expect(connDialog.getByRole('checkbox').and(connDialog.locator(`[value="${MCP_ID}"]`))).toHaveCount(1)
  await expect(connDialog.getByText(MCP_LABEL)).toBeVisible()

  // Dọn lại trạng thái dùng chung của fixture. Điều hướng lại thay vì bấm Huỷ
  // từng lớp: hai dialog đang chồng nhau, backdrop của lớp trên chặn con trỏ.
  await openRunnerConfig(page)
  await openMcpTab(page)
  await removeIfPresent(page, MCP_LABEL)
})
