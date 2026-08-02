import { test, expect } from '@playwright/test'
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
  await expect(runnerDialog.locator('select').first()).toBeVisible()
  await page.getByRole('button', { name: 'Lưu' }).click()
  await expect(runnerDialog).toBeHidden({ timeout: 10_000 })

  await expect(
    page.locator('.runner-list li').filter({ hasText: /E2E Runner/ }).first(),
  ).toBeVisible({ timeout: 10_000 })

  // Edit runner → open connection dialog via +
  await page.locator('.runner-list li').filter({ hasText: /E2E Runner/ }).first().click()
  const editDialog = page.getByRole('dialog', { name: 'Sửa runner' })
  await expect(editDialog).toBeVisible()
  await editDialog.locator('.conn-add').click()
  const connDialog = page.getByRole('dialog', { name: 'Thêm connection' })
  await expect(connDialog).toBeVisible()
  await connDialog.getByLabel('Tên kết nối').fill('E2E Connection')
  await page.getByRole('button', { name: 'Refresh' }).click()
  await connDialog.locator('#conn-command').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Lưu connection' }).click()
  await expect(connDialog).toBeHidden({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Huỷ' }).click()

  await capturePage(page, testInfo, 'runner-config')
})
