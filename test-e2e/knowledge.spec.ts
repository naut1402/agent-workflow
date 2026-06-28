import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// E2E for the features/knowledge module — ported from scripts/verify-knowledge.mjs.
// Covers the knowledge REST roundtrip (create → list → tags → delete) and the
// UI mount, with a capture into docs/<feature>-evidence/.

const EVIDENCE = path.resolve(process.cwd(), 'docs', 'features-knowledge-evidence')

test('knowledge mode mounts the panel (capture)', async ({ page }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Knowledge' }).click()
  await expect(page.locator('.knowledge-panel')).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: path.join(EVIDENCE, 'knowledge.png'), fullPage: true })
  fs.writeFileSync(
    path.join(EVIDENCE, 'verify-results.json'),
    JSON.stringify(
      { feature: 'features-knowledge', checks: [{ name: 'knowledge panel mounts', ok: true }], capturedAt: new Date().toISOString() },
      null,
      2,
    ),
  )
})

test('knowledge REST roundtrip: create → list → tags → delete', async ({ request }, testInfo) => {
  const slug = `e2e-verify-${testInfo.testId}`
  const id = `project/${slug}`

  const create = await request.post('/api/knowledge', {
    data: { title: 'E2E entry', slug, scope: 'project', tags: ['e2e', 'verify'], content: '# E2E\n\nbody' },
  })
  expect(create.ok()).toBeTruthy()
  expect((await create.json()).entry.id).toBe(id)

  const list = await request.get('/api/knowledge?scope=project')
  expect(list.ok()).toBeTruthy()
  expect((await list.json()).entries.some((e: any) => e.id === id)).toBe(true)

  const tags = await request.get('/api/knowledge/tags')
  expect(tags.ok()).toBeTruthy()
  expect((await tags.json()).tags.some((t: any) => t.tag === 'e2e')).toBe(true)

  const del = await request.delete(`/api/knowledge?id=${encodeURIComponent(id)}`)
  expect(del.ok()).toBeTruthy()
})
