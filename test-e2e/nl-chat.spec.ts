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
          { index: 2, role: 'assistant', text: 'Đã cập nhật design.md theo pipeline hiện tại.' },
        ],
        running: { jobId: 'job-e2e', stepId: url.searchParams.get('stepId'), startedAt: null },
        canSend: false,
        blockedReason: 'stepRunning',
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
  await expect(win.locator('.nl-chat-title')).toHaveText('Chat với runner')
  // Scope line names the task + step, and the header reports the live runner.
  await expect(win.locator('.task-chat-scope')).toContainText('DEMO-1')
  await expect(win.locator('.nl-chat-status')).toHaveClass(/is-busy/)
  await expect(win.locator('.nl-chat-status-text')).toContainText('Runner đang chạy')

  // History from the session: both roles plus the tool-activity line.
  await expect(win.locator('.nl-chat-message-user')).toContainText('chạy step design')
  await expect(win.locator('.nl-chat-message-assistant')).toContainText('Đã cập nhật design.md')
  await expect(win.locator('.task-chat-activity')).toContainText('Read')

  // Sending is blocked while the step runs, and the reason is stated.
  await expect(win.locator('.nl-chat-input-row input')).toBeDisabled()
  await expect(win.locator('.task-chat-blocked')).toContainText('Step đang chạy')

  await capture(page, testInfo, 'nl-chat-runner-session')
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
