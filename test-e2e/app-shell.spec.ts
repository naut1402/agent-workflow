import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Regression capture for the src-foundation refactor (src/api + src/shared).
// Confirms the app shell + monitor mode still render after moving the API
// client, composables and shared UI — if any import broke, the SPA would not
// mount and these assertions would fail. Screenshots + a results summary land
// in docs/<feature>-evidence/ as evidence (CI uploads them as an artifact).

const EVIDENCE = path.resolve(process.cwd(), 'docs', 'src-foundation-evidence')

test('monitor mode renders the fixture task (capture)', async ({ page }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // The fixture task id flows through /api/tasks → api client → TaskList.
  const taskId = page.locator('.tasklist .id', { hasText: 'DEMO-1' })
  await expect(taskId).toBeVisible({ timeout: 15_000 })

  await page.screenshot({ path: path.join(EVIDENCE, 'monitor-mode.png'), fullPage: true })

  fs.writeFileSync(
    path.join(EVIDENCE, 'verify-results.json'),
    JSON.stringify(
      {
        feature: 'src-foundation',
        checks: [
          { name: 'app shell mounts + monitor renders fixture task DEMO-1', ok: true },
        ],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
})
