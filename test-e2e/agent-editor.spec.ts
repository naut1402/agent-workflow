import { test, expect, type Page } from '@playwright/test'
import { capturePage } from './_capture'

// `.agent-list-item` chứa cả tên VÀ nhãn nút hành động, nên `hasText` chuỗi
// thường (substring) khớp nhầm "foo" vào cả "foo-copy" — luôn khớp CHÍNH XÁC
// qua `.agent-list-name` (chỉ chứa mỗi tên agent).
function agentRow(page: Page, exactName: string) {
  return page
    .locator('.agent-list-item')
    .filter({ has: page.locator('.agent-list-name', { hasText: new RegExp(`^${exactName}$`) }) })
}

// E2E for features/agent-editor — ported from scripts/verify-agent-editor.mjs.
// Mode mount + create/save a custom agent + per-item download/duplicate/upload
// (T5fd30b3c: toolbar dọn "Template/Sao chép", "Tạo từ mô tả", "Export"; Upload
// và Download/Sao chép chuyển thành icon-button, Download+Sao chép dời xuống
// từng item trong danh sách).

test('agent editor: mount, save agent, toolbar chỉ còn 2 điều khiển (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  // ⚠️ Không dùng waitForLoadState('networkidle') — SSE task/job list (#348)
  // giữ kết nối mở vô thời hạn nên network không bao giờ "idle", chờ nó luôn
  // timeout dù trang đã render xong. `.click()`/`toBeVisible()` bên dưới tự
  // chờ phần tử actionable, không cần networkidle.

  await page.getByRole('button', { name: 'Agent Editor' }).click()
  await expect(page.locator('.agent-editor')).toBeVisible({ timeout: 15_000 })

  // TC-A1: toolbar chỉ còn "Agent mới" + icon-button Upload — không còn
  // Template/Sao chép, Tạo từ mô tả, Export.
  const toolbarButtons = page.locator('.agent-side-actions > button')
  await expect(toolbarButtons).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Template / Sao chép' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tạo từ mô tả' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0)

  // TC-C1: Upload chỉ còn icon, tra được qua aria-label/tooltip.
  const uploadBtn = page.getByRole('button', { name: 'Upload agent' })
  await expect(uploadBtn).toBeVisible()
  await expect(uploadBtn).toHaveText('')

  // Create + save a custom agent → appears in the list.
  await page.getByRole('button', { name: '+ Agent mới' }).click()
  await page.locator('.agent-basic-fields input').first().fill('e2e-verify-agent')
  await page.locator('.agent-form-dialog .modal-foot').getByRole('button', { name: 'Lưu' }).click()
  await expect(page.locator('.agent-list-item', { hasText: 'e2e-verify-agent' })).toBeVisible({ timeout: 10_000 })

  // Lưu KHÔNG tự đóng dialog (message hiện ngay trong form), nên phải đóng tay —
  // backdrop còn đó thì mọi click vào cụm nút cột trái bên dưới đều bị nuốt.
  await page.locator('.agent-form-dialog').getByRole('button', { name: 'Hủy' }).click()
  await expect(page.locator('.agent-form-dialog')).toHaveCount(0)

  await capturePage(page, testInfo, 'agent-editor')
})

// TC-B1/TC-B2: mỗi item có icon-button Download riêng, tải đúng nội dung của
// item vừa bấm — không phụ thuộc agent nào đang xem ở panel chính.
test('agent editor: Download ở mỗi item tải đúng nội dung của item đó', async ({ page }) => {
  await page.goto('/')
  // ⚠️ Không dùng waitForLoadState('networkidle') — SSE task/job list (#348)
  // giữ kết nối mở vô thời hạn nên network không bao giờ "idle", chờ nó luôn
  // timeout dù trang đã render xong. `.click()`/`toBeVisible()` bên dưới tự
  // chờ phần tử actionable, không cần networkidle.
  await page.getByRole('button', { name: 'Agent Editor' }).click()
  await expect(page.locator('.agent-editor')).toBeVisible({ timeout: 15_000 })

  for (const name of ['e2e-download-a', 'e2e-download-b']) {
    await page.getByRole('button', { name: '+ Agent mới' }).click()
    await page.locator('.agent-basic-fields input').first().fill(name)
    await page.locator('.agent-form-dialog .modal-foot').getByRole('button', { name: 'Lưu' }).click()
    await expect(page.locator('.agent-list-item', { hasText: name })).toBeVisible({ timeout: 10_000 })
    await page.locator('.agent-form-dialog').getByRole('button', { name: 'Hủy' }).click()
    await expect(page.locator('.agent-form-dialog')).toHaveCount(0)
  }

  // Mở agent A để xem ở panel chính…
  const rowA = agentRow(page, 'e2e-download-a')
  await rowA.getByRole('button', { name: 'Xem nội dung' }).click()
  await expect(page.locator('.c-md-view')).toContainText('e2e-download-a')

  // …rồi bấm Download ở dòng B — file tải về phải là của B.
  const rowB = agentRow(page, 'e2e-download-b')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    rowB.getByRole('button', { name: 'Download agent' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('e2e-download-b.md')

  // Panel chính không đổi theo thao tác download.
  await expect(page.locator('.c-md-view')).toContainText('e2e-download-a')
})

// TC-D1/TC-D2/TC-D3: mỗi item có icon-button "sao chép" riêng, mở form tạo
// mới điền sẵn theo agent gốc, lưu tạo ra agent độc lập mới trong danh sách.
test('agent editor: Sao chép agent mở form tạo mới điền sẵn, lưu ra agent độc lập', async ({ page }) => {
  await page.goto('/')
  // ⚠️ Không dùng waitForLoadState('networkidle') — SSE task/job list (#348)
  // giữ kết nối mở vô thời hạn nên network không bao giờ "idle", chờ nó luôn
  // timeout dù trang đã render xong. `.click()`/`toBeVisible()` bên dưới tự
  // chờ phần tử actionable, không cần networkidle.
  await page.getByRole('button', { name: 'Agent Editor' }).click()
  await expect(page.locator('.agent-editor')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '+ Agent mới' }).click()
  await page.locator('.agent-basic-fields input').first().fill('e2e-duplicate-src')
  await page.locator('.agent-form-dialog .modal-foot').getByRole('button', { name: 'Lưu' }).click()
  await expect(agentRow(page, 'e2e-duplicate-src')).toBeVisible({ timeout: 10_000 })
  await page.locator('.agent-form-dialog').getByRole('button', { name: 'Hủy' }).click()
  await expect(page.locator('.agent-form-dialog')).toHaveCount(0)

  await agentRow(page, 'e2e-duplicate-src').getByRole('button', { name: 'Sao chép agent' }).click()

  // Form tạo mới (không phải form sửa agent gốc), tên đề xuất phái sinh, không trùng y nguyên.
  await expect(page.locator('.agent-form-dialog .modal-head')).toContainText('Tạo agent mới')
  const nameInput = page.locator('.agent-basic-fields input').first()
  await expect(nameInput).toHaveValue('e2e-duplicate-src-copy')

  await page.locator('.agent-form-dialog .modal-foot').getByRole('button', { name: 'Lưu' }).click()
  await expect(agentRow(page, 'e2e-duplicate-src-copy')).toBeVisible({ timeout: 10_000 })
  await page.locator('.agent-form-dialog').getByRole('button', { name: 'Hủy' }).click()
  await expect(page.locator('.agent-form-dialog')).toHaveCount(0)

  // Agent gốc vẫn còn nguyên, cả hai tồn tại độc lập.
  await expect(agentRow(page, 'e2e-duplicate-src')).toBeVisible()
  await expect(agentRow(page, 'e2e-duplicate-src-copy')).toBeVisible()
})
