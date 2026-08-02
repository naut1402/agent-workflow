import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { capture } from './_capture'

// E2E for F0010 — create task from dashboard dialog (Prompt tab).
// Writes scaffold under the isolated fixture DEV_TEAM_ROOT; cleaned up after run.

const FIXTURE_ROOT = path.resolve(
  process.cwd(),
  'test-e2e/fixtures/project/.dev-team-agent',
)
const TASK_ID = 'E2E-CREATE'

async function cleanupTaskArtifacts() {
  await fs.rm(path.join(FIXTURE_ROOT, '.dev-state', `${TASK_ID}.json`), {
    force: true,
  })
  await fs.rm(path.join(FIXTURE_ROOT, 'tasks', TASK_ID), {
    recursive: true,
    force: true,
  })
}

test.beforeEach(async () => {
  await cleanupTaskArtifacts()
})

test.afterEach(async () => {
  await cleanupTaskArtifacts()
})

test('create task from Prompt tab (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // Open CreateTaskDialog via TaskList header + button.
  await page.getByRole('button', { name: 'Tạo task mới' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tạo task' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })

  await capture(page, testInfo, 'create-task-step1')

  // Step 1 — Prompt tab (default): task id + prompt.
  await dialog.getByLabel('Task ID').fill(TASK_ID)
  await dialog.getByLabel('Prompt').fill('E2E prompt — tạo task từ dashboard')
  await dialog.getByRole('button', { name: 'Tiếp' }).click()

  // Step 2 — pipeline profile (optional; keep default).
  await expect(dialog.getByLabel('Profile pipeline')).toBeVisible()
  await dialog.getByRole('button', { name: 'Tiếp' }).click()

  // Step 3 — knowledge (skip).
  await expect(dialog.getByText('Chọn knowledge inject', { exact: false })).toBeVisible()
  await dialog.getByRole('button', { name: 'Tiếp' }).click()

  // Step 4 — preview; do not tick "Chạy ngay".
  await expect(dialog.locator('code', { hasText: TASK_ID })).toBeVisible()
  await dialog.getByRole('button', { name: 'Tạo task' }).click()

  await expect(dialog).toBeHidden({ timeout: 15_000 })

  // Task appears in the sidebar list and is selected.
  const row = page.locator('.task-row', { hasText: TASK_ID })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row.locator('.id')).toHaveText(TASK_ID)

  await capture(page, testInfo, 'create-task-listed')

  // Scaffold files exist on disk under the fixture root.
  const stateFile = path.join(FIXTURE_ROOT, '.dev-state', `${TASK_ID}.json`)
  const requestFile = path.join(FIXTURE_ROOT, 'tasks', TASK_ID, 'request.md')

  await expect.poll(async () => fs.access(stateFile).then(() => true).catch(() => false)).toBe(
    true,
  )
  await expect.poll(async () => fs.access(requestFile).then(() => true).catch(() => false)).toBe(
    true,
  )

  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'))
  expect(state.task_id).toBe(TASK_ID)
  expect(typeof state.current_phase).toBe('string')

  const requestMd = await fs.readFile(requestFile, 'utf8')
  expect(requestMd).toContain('E2E prompt — tạo task từ dashboard')
  expect(requestMd).toContain('created_by: dashboard')
})

test('stepper skips the optional steps straight to preview (capture)', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Tạo task mới' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tạo task' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })

  const stepper = dialog.getByRole('navigation', { name: 'Các bước tạo task' })
  const previewStep = stepper.getByRole('button', { name: /Xem trước/ })

  // Locked until the source step is satisfied.
  await expect(previewStep).toBeDisabled()

  await dialog.getByLabel('Task ID').fill(TASK_ID)
  await dialog.getByLabel('Prompt').fill('E2E prompt — nhảy bước bằng stepper')
  await expect(previewStep).toBeEnabled()

  // One click instead of three "Tiếp".
  await previewStep.click()
  await expect(dialog.locator('code', { hasText: TASK_ID })).toBeVisible()
  await capture(page, testInfo, 'create-task-stepper-jump')

  // Backward jump still works from preview.
  await stepper.getByRole('button', { name: /Pipeline/ }).click()
  await expect(dialog.getByLabel('Profile pipeline')).toBeVisible()
})
