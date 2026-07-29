import { test, expect } from '@playwright/test'
import { capture } from './_capture'

// E2E for the NL chat surface (F0012) after the UI review on PR #158:
//  1. the window uses the theme panel background, not a hardcoded white one,
//  2. the window follows the floating icon when the icon is dragged,
//  3. opening the chat lands straight in a normal conversation (no "what do
//     you want to create?" picker),
//  4. the icon has no filled background.
// Never sends a message — that would submit a real job against whatever runner
// the shared e2e home dir happens to have configured.

test('nl chat: themed window docks to the draggable icon (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const fab = page.locator('.nl-chat-fab')
  await expect(fab).toBeVisible({ timeout: 15_000 })

  // (4) no filled background on the icon itself.
  const fabBg = await fab.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(fabBg)

  await fab.click()
  const win = page.locator('.nl-chat-window')
  await expect(win).toBeVisible()

  // (3) free-form chat right away — the input row is there, no entity picker.
  await expect(win.locator('.nl-chat-input-row input')).toBeVisible()
  await expect(win).not.toContainText('Bạn muốn tạo gì?')

  // (1) window background follows the theme's --panel token in BOTH themes —
  // the bug was a hardcoded white surface, which only looks right in light.
  for (const theme of ['light', 'dark'] as const) {
    const [winBg, panelBg] = await win.evaluate((el, t) => {
      document.documentElement.setAttribute('data-theme', t)
      const probe = document.createElement('div')
      probe.style.background = 'var(--panel)'
      document.body.appendChild(probe)
      const resolved = getComputedStyle(probe).backgroundColor
      probe.remove()
      return [getComputedStyle(el).backgroundColor, resolved]
    }, theme)
    expect(winBg, `nl-chat window background in ${theme} theme`).toBe(panelBg)
  }

  await capture(page, testInfo, 'nl-chat-window-dark')

  // (2) drag the icon; the window must move with it.
  const before = (await win.boundingBox())!
  const fabBox = (await fab.boundingBox())!
  await page.mouse.move(fabBox.x + fabBox.width / 2, fabBox.y + fabBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(fabBox.x + fabBox.width / 2 - 160, fabBox.y + fabBox.height / 2 - 120, { steps: 8 })
  await page.mouse.up()

  const after = (await win.boundingBox())!
  expect(after.x).toBeLessThan(before.x - 50)
  expect(after.y).toBeLessThan(before.y - 50)

  await capture(page, testInfo, 'nl-chat-window-dragged')
})

test('nl chat: message sides, status indicator and minimize (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // The chat plane is stubbed at the network edge so a real turn renders
  // without submitting a job to whatever runner the shared e2e home dir has
  // configured. The job stays 'running' on the first poll so the typing
  // indicator is observable, then succeeds.
  // Regex (not glob) matchers: a glob's `?` would not line up with the
  // `?project=` query these URLs carry.
  let jobPolls = 0
  await page.route(/\/api\/nl-chat\/sessions(\?|$)/, (route) =>
    route.fulfill({ json: { chatSessionId: 'nlchat-e2e', job: { id: 'job-e2e', status: 'queued' } } }),
  )
  await page.route(/\/api\/nl-chat\/sessions\/[^/?]+/, (route) =>
    route.fulfill({ json: { status: 'ready', kind: 'question', text: 'Bạn muốn đặt taskId là gì?' } }),
  )
  await page.route(/\/api\/jobs\/job-e2e/, (route) => {
    jobPolls += 1
    route.fulfill({ json: { job: { id: 'job-e2e', status: jobPolls > 1 ? 'succeeded' : 'running' } } })
  })

  await page.locator('.nl-chat-fab').click()
  const win = page.locator('.nl-chat-window')
  await expect(win).toBeVisible({ timeout: 15_000 })

  // Status indicator is present and idle before anything is sent.
  await expect(win.locator('.nl-chat-status')).toHaveClass(/is-idle/)
  await expect(win.locator('.nl-chat-status-text')).toHaveText('Sẵn sàng')

  await win.locator('.nl-chat-input-row input').fill('tạo task sửa bug đăng nhập')
  await win.locator('.nl-chat-input-row button').click()

  // While the turn is in flight: busy status + typing indicator.
  await expect(win.locator('.nl-chat-status')).toHaveClass(/is-busy/)
  await expect(win.locator('.nl-chat-typing')).toBeVisible()
  await capture(page, testInfo, 'nl-chat-thinking')

  await expect(win.locator('.nl-chat-message-assistant')).toHaveText('Bạn muốn đặt taskId là gì?', {
    timeout: 15_000,
  })
  await expect(win.locator('.nl-chat-typing')).toHaveCount(0)
  await expect(win.locator('.nl-chat-status')).toHaveClass(/is-idle/)

  const userRow = (await win.locator('.nl-chat-row-user').boundingBox())!
  const assistantRow = (await win.locator('.nl-chat-row-assistant').boundingBox())!
  const winBox = (await win.boundingBox())!
  expect(userRow.x + userRow.width).toBeGreaterThan(assistantRow.x + assistantRow.width)
  expect(assistantRow.x).toBeLessThan(userRow.x)
  expect(userRow.width).toBeLessThan(winBox.width)

  await capture(page, testInfo, 'nl-chat-message-sides')

  // Minimize collapses the body but keeps the header (and its status) visible.
  const body = win.locator('.nl-chat-body')
  await expect(body).toBeVisible()
  await win.locator('.nl-chat-icon-btn[title="Thu nhỏ"]').click()
  await expect(body).toBeHidden()
  await expect(win.locator('.nl-chat-status')).toBeVisible()
  await capture(page, testInfo, 'nl-chat-minimized')

  await win.locator('.nl-chat-icon-btn[title="Mở rộng"]').click()
  await expect(body).toBeVisible()
})
