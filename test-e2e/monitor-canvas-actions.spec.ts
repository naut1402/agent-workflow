import { test, expect } from '@playwright/test'
import { capturePage } from './_capture'

// Tebf65c74 — 2 icon mới góc trên-phải canvas Monitor: auto-layout + đổi
// pipeline profile. Phần này black-box theo test-spec.md; các case cần một
// trình duyệt thật (CSS hover/`:focus-within` reveal, vị trí thực trên canvas)
// mà unit test (jsdom) không dựng CSS layout nên không kiểm chứng được — xem
// tests/src/features/monitor/components/PipelineView.test.ts +
// ProfileSwitchDialog.test.ts cho phần logic/behavior đã phủ ở tầng component.
//
// Không click "Áp dụng" trong dialog đổi profile ở đây: nó ghi thật vào
// `tasks/DEMO-1/pipeline.yaml` của fixture (không nằm trong danh sách
// gitignore như `flow-profiles/`), sẽ làm bẩn cây fixture cho các spec khác.
// Auto-layout thì an toàn — nó chỉ ghi `flow-profiles/<id>.json`, đã gitignore.

async function openTask(page: import('@playwright/test').Page, name: string) {
  await page.goto('/')
  const row = page.locator('.task-row', { hasText: name })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()
}

test.describe('Monitor canvas — icon auto-layout & đổi profile (Tebf65c74)', () => {
  test('TC-01/02/03: icon ẩn mặc định, hiện khi hover canvas, ẩn lại khi rời hover (capture)', async ({ page }, testInfo) => {
    await openTask(page, 'DEMO-1')

    const canvas = page.locator('.vflow-container')
    await expect(canvas).toBeVisible()
    const actions = canvas.locator('.canvas-corner-actions')
    await expect(actions).toHaveCSS('opacity', '0')
    await expect(actions).toHaveCSS('pointer-events', 'none')

    await canvas.hover()
    await expect(actions).toHaveCSS('opacity', '1')
    await expect(actions).toHaveCSS('pointer-events', 'auto')
    await capturePage(page, testInfo, 'monitor-canvas-corner-actions-hover')

    // Rời hẳn khỏi canvas — icon ẩn trở lại.
    await page.mouse.move(2, 2)
    await expect(actions).toHaveCSS('opacity', '0')
  })

  test('TC-12: 2 icon tiếp cận được bằng Tab/focus, hiện khi focus, có aria-label đọc được', async ({ page }) => {
    await openTask(page, 'DEMO-1')

    const actions = page.locator('.canvas-corner-actions')
    const layoutBtn = actions.locator('button.icon-btn').nth(0)
    const swapBtn = actions.locator('button.icon-btn').nth(1)

    await expect(layoutBtn).toHaveAttribute('aria-label', 'Tự sắp xếp layout')
    await expect(layoutBtn).toHaveAttribute('title', 'Tự sắp xếp layout')
    await expect(swapBtn).toHaveAttribute('aria-label', 'Đổi pipeline profile')
    await expect(swapBtn).toHaveAttribute('title', 'Đổi pipeline profile')

    // Focus bằng bàn phím (không hover chuột) vẫn phải lộ overlay ra
    // (`:focus-within` — design.md §4.2g), nếu không 2 nút icon-only này
    // không bao giờ tới được bằng Tab dù có aria-label.
    await layoutBtn.focus()
    await expect(actions).toHaveCSS('opacity', '1')
  })

  test('TC-13: 2 icon nằm ở góc trên-phải canvas, không đè lên node/step đã có', async ({ page }) => {
    await openTask(page, 'DEMO-1')

    const canvas = page.locator('.vflow-container')
    await canvas.hover()
    const canvasBox = (await canvas.boundingBox())!
    const actionsBox = (await page.locator('.canvas-corner-actions').boundingBox())!

    // Nằm trong canvas, sát góc trên-phải (top nhỏ, right gần khớp mép phải).
    expect(actionsBox.y - canvasBox.y).toBeLessThan(40)
    expect(canvasBox.x + canvasBox.width - (actionsBox.x + actionsBox.width)).toBeLessThan(40)

    // Không chồng lên node step đầu tiên trên canvas.
    const firstNodeBox = await page.locator('.vue-flow__node').first().boundingBox()
    if (firstNodeBox) {
      const overlapsVertically = actionsBox.y < firstNodeBox.y + firstNodeBox.height && actionsBox.y + actionsBox.height > firstNodeBox.y
      const overlapsHorizontally = actionsBox.x < firstNodeBox.x + firstNodeBox.width && actionsBox.x + actionsBox.width > firstNodeBox.x
      expect(overlapsVertically && overlapsHorizontally).toBe(false)
    }
  })

  test('TC-04/TC-07: click icon đổi profile mở dialog tại chỗ (không rời Monitor); project chưa có profile hiện rõ trạng thái rỗng (capture)', async ({ page }, testInfo) => {
    await openTask(page, 'DEMO-1')
    const urlBefore = page.url()

    const canvas = page.locator('.vflow-container')
    await canvas.hover()
    await canvas.locator('.canvas-corner-actions button.icon-btn').nth(1).click()

    const dialog = page.locator('.modal[role="dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Đổi pipeline profile')
    // Fixture project của e2e không có pipeline-profiles/ nào — đúng
    // equivalence class TC-07 "danh sách profile rỗng" một cách tự nhiên.
    await expect(dialog).toContainText('Project chưa có pipeline profile nào.')
    await expect(dialog.locator('select')).toHaveCount(0)
    await expect(dialog.locator('.btn-primary')).toBeDisabled()
    expect(page.url()).toBe(urlBefore)
    await capturePage(page, testInfo, 'monitor-canvas-switch-profile-dialog-empty')

    // TC-06: huỷ dialog — không có gì để ghi (danh sách rỗng), đóng sạch.
    await dialog.locator('.btn-ghost').click()
    await expect(dialog).toBeHidden()
    // Vẫn ở đúng task Monitor, canvas không đổi.
    await expect(canvas).toBeVisible()
  })

  test('TC-09/TC-10/TC-11: click icon chỉnh layout tự sắp xếp step, không đổi tập step, bấm liên tiếp không lỗi', async ({ page }) => {
    await openTask(page, 'DEMO-1')

    const canvas = page.locator('.vflow-container')
    await canvas.hover()
    const nodeLabelsBefore = await page.locator('.vue-flow__node').allTextContents()

    const layoutBtn = canvas.locator('.canvas-corner-actions button.icon-btn').nth(0)
    await layoutBtn.click()
    await layoutBtn.click()
    await layoutBtn.click()
    // Ba lượt ghi fire-and-forget nối tiếp (§4.4 #3) — đợi request cuối ổn định.
    await page.waitForTimeout(300)

    const nodeLabelsAfter = await page.locator('.vue-flow__node').allTextContents()
    expect(nodeLabelsAfter.sort()).toEqual(nodeLabelsBefore.sort())
    // Không có toast lỗi nào phát sinh, canvas vẫn hiển thị bình thường.
    await expect(page.locator('.chip-err')).toHaveCount(0)
    await expect(canvas).toBeVisible()
  })

  test('TC-14: task đã completed (DEMO-2) ẩn cả 2 icon kể cả khi hover canvas', async ({ page }) => {
    await openTask(page, 'DEMO-2')

    const canvas = page.locator('.vflow-container')
    await expect(canvas).toBeVisible()
    await canvas.hover()
    await expect(canvas.locator('.canvas-corner-actions')).toHaveCount(0)
  })
})
