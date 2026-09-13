import { test, expect } from '@playwright/test'
import { capturePage } from './_capture'

// E2E for the features/knowledge module — ported from scripts/verify-knowledge.mjs.
// Covers the knowledge REST roundtrip (create → list → tags → delete) and the
// UI mount; screenshot attaches via testInfo (not docs/).

// Neo `.knowledge-panel` nay nằm ở ROOT layout, KHÔNG trên `main`: chưa chọn
// entry thì `hideMain` thu `main` về 0, nên neo đặt ở đó sẽ không bao giờ visible.
test('knowledge mode mounts the panel (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Knowledge' }).click()
  await expect(page.locator('.knowledge-panel')).toBeVisible({ timeout: 15_000 })
  // Cột trái là sub-menu với 3 nhóm collapse; chưa chọn entry ⇒ main thu về 0.
  await expect(page.locator('.knowledge-side-menu')).toBeVisible()
  await expect(page.locator('.knowledge-group')).toHaveCount(3)
  await expect(page.locator('.c-screen-layout__body--no-main')).toBeVisible()
  await capturePage(page, testInfo, 'knowledge')
})

test('chọn entry ⇒ main hiện markdown; bỏ chọn ⇒ main thu lại', async ({ page, request }, testInfo) => {
  const slug = `e2e-view-${testInfo.testId}`
  const id = `project/${slug}`
  const created = await request.post('/api/knowledge', {
    data: { title: 'E2E xem', slug, scope: 'project', content: '## Mục A\n\nnội dung e2e' },
  })
  expect(created.ok()).toBeTruthy()

  try {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Knowledge' }).click()
    await expect(page.locator('.knowledge-panel')).toBeVisible({ timeout: 15_000 })

    const row = page.locator('.knowledge-list-item', { hasText: 'E2E xem' }).first()
    await row.getByRole('button', { name: 'Xem nội dung' }).click()

    await expect(page.locator('.c-md-view')).toBeVisible()
    await expect(page.locator('.c-md-body')).toContainText('nội dung e2e')
    await expect(page.locator('.c-screen-layout__body--no-main')).toHaveCount(0)
  } finally {
    await request.delete(`/api/knowledge?id=${encodeURIComponent(id)}`)
  }
})

test('khứ hồi tag: tạo → gắn màu → lọc theo tag', async ({ page, request }, testInfo) => {
  const tag = `e2etag${testInfo.testId}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)
  const slug = `e2e-tag-${testInfo.testId}`
  const id = `project/${slug}`

  // Tag tồn tại được TRƯỚC khi có entry nào mang nó — đó là điểm mới của task.
  const made = await request.post('/api/knowledge/tags', { data: { tag, color: 'purple' } })
  expect(made.ok()).toBeTruthy()

  try {
    const empty = await request.get('/api/knowledge/tags')
    expect((await empty.json()).tags).toContainEqual(
      expect.objectContaining({ tag, count: 0, color: 'purple' }),
    )

    await request.post('/api/knowledge', {
      data: { title: 'E2E tag', slug, scope: 'project', tags: [tag], content: 'body' },
    })

    const withEntry = await request.get('/api/knowledge/tags')
    expect((await withEntry.json()).tags).toContainEqual(
      expect.objectContaining({ tag, count: 1, color: 'purple' }),
    )

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Knowledge' }).click()
    await expect(page.locator('.knowledge-panel')).toBeVisible({ timeout: 15_000 })

    // Nhóm Tag gập mặc định — mở ra rồi lọc theo chip.
    const tagGroup = page.locator('.knowledge-group').nth(2)
    await tagGroup.locator('summary').click()
    const chip = tagGroup.locator('.chip-tag', { hasText: tag }).first()
    await expect(chip).toBeVisible()
    // Màu đọc từ token trong DB, không phải hex cứng trong component.
    await expect(chip).toHaveAttribute('style', /--tag-c: var\(--tag-purple\)/)

    await tagGroup.locator('.knowledge-tag-name', { hasText: tag }).first().click()
    const docGroup = page.locator('.knowledge-group').first()
    await expect(docGroup.locator('.knowledge-list-item')).toHaveCount(1)
    await expect(docGroup).toContainText('E2E tag')
  } finally {
    await request.delete(`/api/knowledge?id=${encodeURIComponent(id)}`)
    await request.post('/api/knowledge/tags/rename', { data: { from: tag } })
  }
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
  // Facet nay mang kèm metadata; tag chưa đặt màu rơi về token mặc định.
  expect((await tags.json()).tags).toContainEqual(
    expect.objectContaining({ tag: 'e2e', color: 'slate' }),
  )

  const del = await request.delete(`/api/knowledge?id=${encodeURIComponent(id)}`)
  expect(del.ok()).toBeTruthy()
})
