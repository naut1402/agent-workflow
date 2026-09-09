import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { capturePage } from './_capture'

// E2E capture for the features/monitor module. Confirms the moved monitor
// components (TaskList → file list → ArtifactPanel) still wire up after the
// feature-module migration: select the fixture task, expand its artifacts.

test('select task expands artifact list (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const row = page.locator('.task-row', { hasText: 'DEMO-1' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()

  // The fixture task has investigate.md + design.md artifacts.
  await expect(page.locator('.file-item .file-name', { hasText: 'investigate.md' })).toBeVisible()

  await capturePage(page, testInfo, 'monitor-task-expanded')
})

// Relative links inside an artifact resolve against the current task and open in
// the panel — the browser must not navigate the SPA away to a bare file path.
test('relative artifact link opens the target in the panel (capture)', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const url = page.url()

  const row = page.locator('.task-row', { hasText: 'DEMO-1' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()

  await page.locator('.file-item .file-name', { hasText: 'investigate.md' }).click()
  await expect(page.locator('.art-title')).toHaveText('investigate.md')

  await page.locator('.art-view a', { hasText: 'Design' }).click()

  await expect(page.locator('.art-title')).toHaveText('design.md')
  expect(page.url()).toBe(url)
  await capturePage(page, testInfo, 'monitor-relative-link')

  // A link to a file the task does not have keeps the current artifact and
  // reports why instead of navigating.
  await page.locator('.file-item .file-name', { hasText: 'investigate.md' }).click()
  await expect(page.locator('.art-title')).toHaveText('investigate.md')
  await page.locator('.art-view a', { hasText: 'Khong co' }).click()

  await expect(page.locator('.art-message')).toContainText('khong-co.md')
  await expect(page.locator('.art-title')).toHaveText('investigate.md')
  expect(page.url()).toBe(url)
  expect(errors).toEqual([])
})

// Pasting inside the markdown editor must insert the clipboard text and keep the
// editor in edit mode. Only a real browser covers this: Toast UI focuses a hidden
// textarea on Ctrl/Cmd+V, which used to trip auto-save-on-blur and tear the
// editor down before the paste landed.
//
// The target artifact is written here rather than committed: the test saves into
// it for real, so a committed fixture would be left dirty whenever the run is
// killed hard. `.gitignore` covers the path.
const PASTE_FIXTURE = path.join(
  fileURLToPath(new URL('.', import.meta.url)),
  'fixtures/project/.dev-team-agent/tasks/DEMO-1/paste-target.md',
)
const PASTE_FIXTURE_BODY = [
  '# Paste target — DEMO-1',
  '',
  '## Nội dung',
  '',
  'Một dòng để đặt con trỏ vào khi vào chế độ chỉnh sửa.',
  '',
].join('\n')
// Windows/Linux dùng Control, macOS dùng Meta — hardcode một phím thì phía kia
// bấm ra tổ hợp vô nghĩa và test đỏ với lý do sai.
const PASTE_KEY = process.platform === 'darwin' ? 'Meta+v' : 'Control+v'

test.beforeAll(async () => {
  await fs.writeFile(PASTE_FIXTURE, PASTE_FIXTURE_BODY, 'utf8')
})

test.afterAll(async () => {
  await fs.rm(PASTE_FIXTURE, { force: true })
})

test('paste in the markdown editor keeps edit mode and saves (capture)', async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('.task-row', { hasText: 'DEMO-1' }).click()
  await page.locator('.file-item .file-name', { hasText: 'paste-target.md' }).click()
  await expect(page.locator('.art-title')).toHaveText('paste-target.md')

  await page.evaluate(() => navigator.clipboard.writeText('DAN-DONG-1\nDAN-DONG-2'))

  await page.locator('.block-content.md-editable').first().dblclick()
  const editor = page.locator('[data-testid="markdown-text-editor"]')
  await expect(editor).toBeVisible()

  await page.locator('.toastui-editor-md-container .ProseMirror').click()
  await page.keyboard.press(PASTE_KEY)

  // The whole point: still editing, with both pasted lines in the draft.
  await expect(editor).toBeVisible()
  await expect(page.locator('.toastui-editor-md-container .ProseMirror')).toContainText(
    'DAN-DONG-1',
  )
  await expect(page.locator('.toastui-editor-md-container .ProseMirror')).toContainText(
    'DAN-DONG-2',
  )
  await capturePage(page, testInfo, 'monitor-paste-keeps-edit')

  // Blur still exits and saves — the guard must not strand the editor.
  await page.locator('.art-toolbar').click()
  await expect(editor).toHaveCount(0)
  await expect(page.locator('.art-view')).toContainText('DAN-DONG-1')

  // And the pasted text survived the round trip to disk.
  await page.locator('.file-item .file-name', { hasText: 'design.md' }).click()
  await page.locator('.file-item .file-name', { hasText: 'paste-target.md' }).click()
  await expect(page.locator('.art-view')).toContainText('DAN-DONG-2')
})
