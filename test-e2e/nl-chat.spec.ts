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
