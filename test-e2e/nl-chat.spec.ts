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
  await expect(win.locator('.nl-chat-input-row textarea')).toBeVisible()
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

  // Idle: no status icon at all (it only appears when something is happening).
  await expect(win.locator('.nl-chat-status')).toHaveCount(0)

  // Multi-line composer: Shift+Enter adds a line and the box grows; Enter sends.
  const composer = win.locator('.nl-chat-input-row textarea')
  const oneLine = (await composer.boundingBox())!.height
  await composer.click()
  await composer.type('dòng 1')
  await composer.press('Shift+Enter')
  await composer.type('dòng 2')
  expect(await composer.inputValue()).toContain('\n')
  expect((await composer.boundingBox())!.height).toBeGreaterThan(oneLine)

  await composer.fill('tạo task sửa bug đăng nhập')
  await composer.press('Enter')

  // While the turn is in flight: busy status icon (spinner) + typing indicator.
  await expect(win.locator('.nl-chat-status')).toHaveClass(/is-busy/)
  await expect(win.locator('.nl-chat-status .nl-chat-spinner')).toBeVisible()
  await expect(win.locator('.nl-chat-typing')).toBeVisible()
  await capture(page, testInfo, 'nl-chat-thinking')

  await expect(win.locator('.nl-chat-message-assistant')).toHaveText('Bạn muốn đặt taskId là gì?', {
    timeout: 15_000,
  })
  await expect(win.locator('.nl-chat-typing')).toHaveCount(0)
  await expect(win.locator('.nl-chat-status')).toHaveCount(0)

  const userRow = (await win.locator('.nl-chat-row-user').boundingBox())!
  const assistantRow = (await win.locator('.nl-chat-row-assistant').boundingBox())!
  const winBox = (await win.boundingBox())!
  expect(userRow.x + userRow.width).toBeGreaterThan(assistantRow.x + assistantRow.width)
  expect(assistantRow.x).toBeLessThan(userRow.x)
  expect(userRow.width).toBeLessThan(winBox.width)

  await capture(page, testInfo, 'nl-chat-message-sides')

  // Minimize hides the whole window (not a header-only strip), and the icon
  // brings the SAME conversation back — messages are not re-fetched/reset.
  await win.locator('.nl-chat-icon-btn[title="Thu nhỏ"]').click()
  await expect(win).toBeHidden()
  await capture(page, testInfo, 'nl-chat-minimized')

  await page.locator('.nl-chat-fab').click()
  await expect(win).toBeVisible()
  await expect(win.locator('.nl-chat-message-assistant')).toHaveText('Bạn muốn đặt taskId là gì?')
})

test('pipeline node popover opens a step-scoped runner chat (capture)', async ({ page }, testInfo) => {
  // The chat endpoint is stubbed: the fixture project has no CLI session, and a
  // real one would need a configured runner. Shape mirrors GET /api/tasks/:id/chat.
  await page.route(/\/api\/tasks\/[^/]+\/chat/, (route) => {
    const url = new URL(route.request().url())
    route.fulfill({
      json: {
        taskId: 'DEMO-1',
        stepId: url.searchParams.get('stepId'),
        sessionId: 'sess-e2e',
        transcriptFound: true,
        total: 3,
        turns: [
          { index: 0, role: 'user', text: 'chạy step design' },
          { index: 1, role: 'tool', tool: 'Read', text: 'docs/design.md' },
          {
            index: 2,
            role: 'assistant',
            // Markdown: the reply must render, not show raw ** / - / ` syntax.
            text: '**Đã cập nhật** design.md:\n\n- thêm §4\n- sửa `steps[].agent`',
          },
        ],
        running: { jobId: 'job-e2e', stepId: url.searchParams.get('stepId'), startedAt: null },
        runner: { id: 'runner-e2e', name: 'Runner E2E', enabled: true },
        canSend: true,
        queued: true,
      },
    })
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('.task-row', { hasText: 'DEMO-1' }).click()

  const node = page.locator('.pnode', { hasText: 'Design' }).first()
  await expect(node).toBeVisible({ timeout: 15_000 })

  // Pinned in the node's corner — visible without hovering, so moving the
  // cursor to it can never make it disappear.
  await expect(node.locator('.pnode-chat-btn')).toBeVisible()
  await node.locator('.pnode-chat-btn').click()

  const win = page.locator('.nl-chat-window')
  await expect(win).toBeVisible()
  // Badge icon replaces the prose title; the title carries task + step instead.
  await expect(win.locator('.nl-chat-badge.is-task')).toBeVisible()
  await expect(win.locator('.nl-chat-title')).toContainText('DEMO-1')
  await expect(win.locator('.nl-chat-title')).toContainText('Design')
  // Live runner: icon-only status, label kept as the tooltip.
  await expect(win.locator('.nl-chat-status')).toHaveClass(/is-busy/)
  await expect(win.locator('.nl-chat-status')).toHaveAttribute('title', /Runner đang chạy/)

  // History from the session: both roles plus the tool-activity line.
  await expect(win.locator('.nl-chat-message-user')).toContainText('chạy step design')
  const reply = win.locator('.nl-chat-message-assistant')
  await expect(reply).toContainText('Đã cập nhật')
  await expect(reply.locator('strong')).toHaveText('Đã cập nhật')
  await expect(reply.locator('li')).toHaveCount(2)
  await expect(reply.locator('code')).toHaveText('steps[].agent')
  await expect(reply).not.toContainText('**')
  await expect(win.locator('.task-chat-activity')).toContainText('Read')

  // Sending while the step runs is no longer blocked — the message is queued
  // instead, so the input stays enabled and its placeholder explains that.
  const input = win.locator('.nl-chat-input-row textarea')
  await expect(input).toBeEnabled()
  await expect(input).toHaveAttribute('placeholder', /sẽ được gửi/)

  // Info icon after the title: hover shows what this chat is bound to.
  const info = win.locator('.nl-chat-info')
  await expect(win.locator('.nl-chat-info-popover')).toHaveCount(0)
  await info.hover()
  const popover = win.locator('.nl-chat-info-popover')
  await expect(popover).toBeVisible()
  await expect(popover).toContainText('Project')
  await expect(popover).toContainText('DEMO-1')
  await expect(popover).toContainText('Design')
  // Runner name + live status (the stub reports a running job).
  await expect(popover).toContainText('Runner E2E')
  await expect(popover).toContainText('đang chạy')

  await capture(page, testInfo, 'nl-chat-runner-session')

  // Leaving the icon hides it again.
  await win.locator('.nl-chat-title').hover()
  await expect(popover).toHaveCount(0)
})

test('step node corner actions: run opens the confirm dialog, chat sits next to it (capture)', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('.task-row', { hasText: 'DEMO-1' }).click()

  // The fixture task's current phase is `designer`, so that node is runnable.
  const runnableNode = page.locator('.pnode.active').first()
  await expect(runnableNode).toBeVisible({ timeout: 15_000 })
  await expect(runnableNode.locator('.pnode-run-btn')).toBeVisible()
  await expect(runnableNode.locator('.pnode-chat-btn')).toBeVisible()

  // A finished (done) node cannot run — only the chat action is offered.
  const doneNode = page.locator('.pnode.done').first()
  await expect(doneNode.locator('.pnode-chat-btn')).toBeVisible()
  await expect(doneNode.locator('.pnode-run-btn')).toHaveCount(0)

  // A step that never ran has no CLI session → run only, no chat.
  const pendingNode = page.locator('.pnode.pending').first()
  await expect(pendingNode.locator('.pnode-run-btn')).toBeVisible()
  await expect(pendingNode.locator('.pnode-chat-btn')).toHaveCount(0)

  await capture(page, testInfo, 'pipeline-node-actions')

  // Run goes through the same confirm dialog as clicking the node.
  await runnableNode.locator('.pnode-run-btn').click()
  await expect(page.locator('.modal-backdrop')).toBeVisible()
  await page.locator('.modal-backdrop .btn-ghost').click()
  await expect(page.locator('.modal-backdrop')).toHaveCount(0)
})

test('nl chat: resize by dragging corners, size persists across reloads (capture)', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('.nl-chat-fab').click()

  const win = page.locator('.nl-chat-window')
  await expect(win).toBeVisible({ timeout: 15_000 })
  const before = (await win.boundingBox())!

  async function dragCorner(corner: string, dx: number, dy: number) {
    const grip = (await win.locator(`.nl-chat-resize.is-${corner}`).boundingBox())!
    const x = grip.x + grip.width / 2
    const y = grip.y + grip.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y + dy, { steps: 8 })
    await page.mouse.up()
    return (await win.boundingBox())!
  }

  // Top-left grip: dragging up/left grows both dimensions, right/bottom stay put.
  const grown = await dragCorner('tl', -80, -60)
  expect(grown.width).toBeGreaterThan(before.width + 50)
  expect(grown.height).toBeGreaterThan(before.height + 40)
  expect(Math.round(grown.x + grown.width)).toBe(Math.round(before.x + before.width))

  await capture(page, testInfo, 'nl-chat-resized')

  // Bottom-right grip: dragging right/down also grows, by shifting the anchored
  // edges outward — so the right edge moves right (until it hits the viewport
  // margin, which is why the left edge is not asserted to stay put).
  const grown2 = await dragCorner('br', 40, 30)
  expect(grown2.width).toBeGreaterThan(grown.width + 20)
  expect(grown2.x + grown2.width).toBeGreaterThan(grown.x + grown.width)

  // Never smaller than the floor, however far the grip is dragged inward.
  const shrunk = await dragCorner('tl', 900, 900)
  expect(shrunk.width).toBeGreaterThanOrEqual(260)
  expect(shrunk.height).toBeGreaterThanOrEqual(220)

  // Size survives a reload (localStorage), like the icon position.
  const resized = await dragCorner('tl', -120, -90)
  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.locator('.nl-chat-fab').click()
  const restored = (await page.locator('.nl-chat-window').boundingBox())!
  expect(Math.round(restored.width)).toBe(Math.round(resized.width))
  expect(Math.round(restored.height)).toBe(Math.round(resized.height))
})
