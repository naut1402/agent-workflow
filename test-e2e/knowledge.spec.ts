import { test, expect } from '@playwright/test'
import { capture } from './_capture'

// E2E for the features/knowledge module — ported from scripts/verify-knowledge.mjs.
// Covers the knowledge REST roundtrip (create → list → tags → delete) and the UI mount.

test('knowledge mode mounts the panel (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Knowledge' }).click()
  await expect(page.locator('.knowledge-panel')).toBeVisible({ timeout: 15_000 })
  await capture(page, testInfo, 'knowledge')
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
