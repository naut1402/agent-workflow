import { test, expect, type Locator } from '@playwright/test'
import { capturePage } from './_capture'

// E2E for features/runner — ported from scripts/verify-runners.mjs.
// Runner Config mode mount + create/save a runner → appears in the list.
// Writes go to the isolated DEV_TEAM_DASHBOARD_HOME (see playwright.config).

test('runner config: mount + save runner roundtrip (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.locator('button[title="Runner Config"]').click()
  await expect(page.locator('.runner-config')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '+ Thêm runner' }).click()
  const runnerDialog = page.getByRole('dialog', { name: 'Thêm runner' })
  await expect(runnerDialog).toBeVisible()
  await runnerDialog.getByLabel('Tên runner').fill('E2E Runner')
  await expect(runnerDialog.getByRole('button', { name: 'Connection', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Lưu' }).click()
  await expect(runnerDialog).toBeHidden({ timeout: 10_000 })

  await expect(
    page.locator('.runner-list li').filter({ hasText: /E2E Runner/ }).first(),
  ).toBeVisible({ timeout: 10_000 })

  // Edit runner → open connection dialog via +
  await page.locator('.runner-list li').filter({ hasText: /E2E Runner/ }).first().click()
  const editDialog = page.getByRole('dialog', { name: 'Sửa runner' })
  await expect(editDialog).toBeVisible()
  await editDialog.getByRole('button', { name: 'Thêm connection' }).click()
  const connDialog = page.getByRole('dialog', { name: 'Thêm connection' })
  await expect(connDialog).toBeVisible()
  await connDialog.getByLabel('Tên kết nối').fill('E2E Connection')
  await page.getByRole('button', { name: 'Refresh' }).click()
  await connDialog.getByRole('button', { name: 'Command', exact: true }).click()
  await connDialog.getByRole('option').first().click()
  await page.getByRole('button', { name: 'Lưu connection' }).click()
  await expect(connDialog).toBeHidden({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Huỷ' }).click()

  await capturePage(page, testInfo, 'runner-config')
})

// TC-A1 dùng lại cho cả 3 dialog trong luồng Runner Config: mép ngoài của
// `.c-select` phải trùng mép vùng bấm được, và phần tử ngoài cùng không được
// đóng góp padding/border riêng (đó chính là hộp lồng hộp user report).
// `CComboSelect` cũng mang class `.c-select` ở root nhưng vùng bấm của nó là
// `.c-combo-trigger` — lọc riêng để không đo nhầm.
async function assertNoNestedBox(scope: Locator) {
  const roots = scope.locator('.c-select:not(.c-combo-select)')
  const count = await roots.count()
  // Không có assert này thì test xanh giả khi selector/markup đổi.
  expect(count).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    const root = roots.nth(i)
    const outer = (await root.boundingBox())!
    const hit = (await root.locator('.c-select-trigger').boundingBox())!
    expect(Math.abs(outer.x - hit.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(outer.y - hit.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(outer.width - hit.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(outer.height - hit.height)).toBeLessThanOrEqual(1)

    const box = await root.evaluate((el) => {
      const s = getComputedStyle(el)
      return {
        pad: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft],
        border: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
      }
    })
    expect(box.pad).toEqual(['0px', '0px', '0px', '0px'])
    expect(box.border).toEqual(['0px', '0px', '0px', '0px'])
  }
}

// Select nằm trong hàng ngang: hàng không xuống dòng, select không tóp lại về
// bề rộng nội dung (đây là thứ đỏ nếu rule kích thước `.cfg-select` bị gõ sai
// tên), không lòi khỏi mép phải dialog.
async function assertRowSelectStretches(dialog: Locator, rowSelector: string) {
  const row = dialog.locator(rowSelector).first()
  const select = (await row.locator('.c-select:not(.c-combo-select)').first().boundingBox())!
  const rowBox = (await row.boundingBox())!
  expect(rowBox.height).toBeLessThanOrEqual(select.height + 4)
  expect(select.width).toBeGreaterThanOrEqual(80)
  const dialogBox = (await dialog.boundingBox())!
  expect(select.x + select.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1)
}

// Regression 1.1.0 (task Tb692264f): `<select class="cfg-input">` đổi sang
// `<CSelect class="cfg-input">` mà không gỡ class → class control native rơi
// vào div wrapper của CSelect, trong khi trigger bên trong đã có nền/viền/
// padding riêng → hộp lồng hộp ("select xuất hiện padding"). Lỗi thuần hình
// học, chỉ browser thật đo được — xem lưới an toàn cấu trúc ở
// tests/src/features/runner/components/RunnerDialog.test.ts.
test('runner config: dropdown chỉ vẽ một hộp, thẳng hàng với ô nhập text', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.locator('button[title="Runner Config"]').click()
  await expect(page.locator('.runner-config')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '+ Thêm runner' }).click()
  const dialog = page.getByRole('dialog', { name: 'Thêm runner' })
  await expect(dialog).toBeVisible()

  // TC-A1
  await assertNoNestedBox(dialog)

  // TC-A2: select "Timeout job" và ô "Tên runner" cùng là con full-width của
  // một `.field` → phải cùng bề rộng, cùng mép trái. Đây đúng là dấu hiệu người
  // dùng report: control trông dày/thụt vào so với ô nhập cùng form.
  const inputBox = (await dialog.getByLabel('Tên runner').boundingBox())!
  const timeoutBox = (await dialog
    .locator('.c-select', { has: page.locator('[aria-label="Timeout job"]') })
    .boundingBox())!
  expect(Math.abs(inputBox.width - timeoutBox.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(inputBox.x - timeoutBox.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(inputBox.height - timeoutBox.height)).toBeLessThanOrEqual(4)

  // Select trong hàng ngang (Connection + nút thêm).
  await assertRowSelectStretches(dialog, '.connection-row')
})

// TC-A3: 4/6 call-site đã sửa nằm ở ConnectionDialog (×3) và ProviderDialog
// (×1). Assert class ở jsdom là điều kiện cần chứ không đủ — nó vẫn xanh khi
// rule kích thước `.cfg-select` bị gõ sai tên, lúc đó select tóp lại về bề rộng
// nội dung mà không test nào đỏ. Nên lặp phép đo hình học ở cả 2 dialog này.
test('runner config: dropdown của Connection/Provider dialog cũng chỉ vẽ một hộp', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.locator('button[title="Runner Config"]').click()
  await expect(page.locator('.runner-config')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '+ Thêm runner' }).click()
  const runnerDialog = page.getByRole('dialog', { name: 'Thêm runner' })
  await expect(runnerDialog).toBeVisible()

  await runnerDialog.getByRole('button', { name: 'Thêm connection' }).click()
  const connDialog = page.getByRole('dialog', { name: 'Thêm connection' })
  await expect(connDialog).toBeVisible()

  // kind = local-console (mặc định): select Command nằm trong `.command-row`.
  await assertNoNestedBox(connDialog)
  await assertRowSelectStretches(connDialog, '.command-row')

  // kind = ai-provider: lộ ra select Provider (`.command-row`) và select
  // Credential (`.credential-row`) — 2 call-site còn lại của dialog này.
  await connDialog.getByRole('radio', { name: 'AI provider' }).check()
  await assertNoNestedBox(connDialog)
  await assertRowSelectStretches(connDialog, '.command-row')

  await connDialog.getByRole('button', { name: 'Cấu hình provider', exact: true }).click()
  const providerDialog = page.getByRole('dialog', { name: 'Cấu hình provider' })
  await expect(providerDialog).toBeVisible()
  await assertNoNestedBox(providerDialog)

  // Select Interface là con full-width của `.field` → phải rộng bằng ô nhập
  // "Tên provider" ngay trên nó, giống TC-A2 của RunnerDialog.
  const nameBox = (await providerDialog.getByLabel('Tên provider').boundingBox())!
  const ifaceBox = (await providerDialog
    .locator('.c-select', { has: page.locator('[aria-label="Interface"]') })
    .boundingBox())!
  expect(Math.abs(nameBox.width - ifaceBox.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(nameBox.x - ifaceBox.x)).toBeLessThanOrEqual(1)
})
