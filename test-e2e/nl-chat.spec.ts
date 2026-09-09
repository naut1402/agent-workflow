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

  // Idle: the status is carried by the title's own colour class. The dot badge
  // and the separate status slot are both gone from the header.
  const title = win.locator('.nl-chat-title')
  await expect(title).toHaveClass(/is-idle/)
  await expect(win.locator('.nl-chat-badge')).toHaveCount(0)
  await expect(win.locator('.nl-chat-status')).toHaveCount(0)

  // Two-line composer. The empty box already stands two lines tall, and that is
  // a FLOOR: typing must never shrink it back to one line (the box auto-grows by
  // writing an inline height, which the CSS min-height has to outrank).
  const composer = win.locator('.nl-chat-input-row textarea')
  const twoLines = (await composer.boundingBox())!.height
  expect(twoLines).toBeGreaterThanOrEqual(40)

  await composer.click()
  await composer.type('a')
  expect((await composer.boundingBox())!.height).toBe(twoLines)

  // Past two lines it grows again; Shift+Enter is still the newline key.
  await composer.fill('')
  await composer.type('dòng 1')
  await composer.press('Shift+Enter')
  await composer.type('dòng 2')
  await composer.press('Shift+Enter')
  await composer.type('dòng 3')
  expect(await composer.inputValue()).toContain('\n')
  expect((await composer.boundingBox())!.height).toBeGreaterThan(twoLines)

  // Clearing it drops back to the floor, not below.
  await composer.fill('')
  expect((await composer.boundingBox())!.height).toBe(twoLines)

  await composer.fill('tạo task sửa bug đăng nhập')
  await composer.press('Enter')

  // Sending resets the box — and the reset must land on the floor too.
  await expect(composer).toHaveValue('')
  expect((await composer.boundingBox())!.height).toBe(twoLines)

  // While the turn is in flight the title takes the busy colour; no spinner is
  // left anywhere in the header.
  await expect(title).toHaveClass(/is-busy/)
  await expect(win.locator('.nl-chat-spinner')).toHaveCount(0)
  await expect(win.locator('.nl-chat-typing')).toBeVisible()
  await capture(page, testInfo, 'nl-chat-thinking')

  await expect(win.locator('.nl-chat-message-assistant')).toHaveText('Bạn muốn đặt taskId là gì?', {
    timeout: 15_000,
  })
  await expect(win.locator('.nl-chat-typing')).toHaveCount(0)
  await expect(title).not.toHaveClass(/is-busy/)

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
  // The title carries task + step AND the status: colour class plus the status
  // spelled out in its tooltip, since there is no status icon any more.
  const title = win.locator('.nl-chat-title')
  await expect(title).toContainText('DEMO-1')
  await expect(title).toContainText('Design')
  await expect(title).toHaveClass(/is-busy/)
  await expect(title).toHaveAttribute('title', /Runner đang chạy/)
  await expect(win.locator('.nl-chat-status')).toHaveCount(0)
  await expect(win.locator('.nl-chat-badge')).toHaveCount(0)
  // The same status as text, for anyone who cannot read the colour. The live
  // region announces the KIND, not the tooltip text — the busy text can carry a
  // ticking seconds counter, and a polite live region would re-read it every
  // second. The detail stays in the tooltip asserted just above.
  await expect(win.locator('.nl-chat-sr-only[role="status"]')).toHaveText('Đang xử lý')

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

  // Info icon leads the header now (it took the connection dot's slot): hover
  // shows what this chat is bound to.
  const info = win.locator('.nl-chat-info')
  await expect(win.locator('.nl-chat-info-popover')).toHaveCount(0)
  await info.hover()
  const popover = win.locator('.nl-chat-info-popover')
  await expect(popover).toBeVisible()
  await expect(popover).toContainText('DEMO-1')
  await expect(popover).toContainText('Design')
  // Shell context rows: the dashboard mode this chat was opened from.
  await expect(popover).toContainText('Mode')
  await expect(popover).toContainText('Monitor')
  // Runner name + live status (the stub reports a running job).
  await expect(popover).toContainText('Runner E2E')
  await expect(popover).toContainText('đang chạy')
  // The connection state the dropped dot used to carry lives here now.
  await expect(popover).toContainText('Kết nối')
  // Anchored left, under the icon, and it must not spill out of the window.
  const winBox = (await win.boundingBox())!
  const popBox = (await popover.boundingBox())!
  expect(popBox.x).toBeGreaterThanOrEqual(winBox.x - 1)
  expect(popBox.x + popBox.width).toBeLessThanOrEqual(winBox.x + winBox.width + 1)

  await capture(page, testInfo, 'nl-chat-runner-session')
  await win.locator('.nl-chat-title').hover()
  await expect(popover).toHaveCount(0)

  // Hover is not the only way in — the connection row lives in here now, and a
  // touch device has no hover at all. Clicking pins the popover so it survives
  // the pointer moving off the 14px icon.
  await info.locator('button').click()
  await expect(popover).toBeVisible()
  await win.locator('.nl-chat-title').hover()
  await expect(popover).toBeVisible()
  // ...and all three ways back out close it.
  await info.locator('button').click()
  await expect(popover).toHaveCount(0)

  await info.locator('button').click()
  await expect(popover).toBeVisible()
  // The composer, not the message list — the popover hangs over the top of the
  // list, so a click up there would land on the popover itself.
  await win.locator('.nl-chat-input-row textarea').click()
  await expect(popover).toHaveCount(0)

  await info.locator('button').click()
  await expect(popover).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)

  // A new session now comes from the composer's + menu, and it still only
  // pushes a builder chat on top — the step's own session is left alone, so no
  // close-session call goes out.
  let closeSessionCalled = false
  await page.route(/\/api\/tasks\/[^/]+\/close-session/, (route) => {
    closeSessionCalled = true
    route.fulfill({ json: { ok: true } })
  })
  await expect(win.locator('.nl-chat-icon-btn[title="Phiên chat mới"]')).toHaveCount(0)
  await win.locator('.nl-chat-session:visible .nl-chat-composer-add > button').click()
  await win.locator('.nl-chat-composer-menu-item', { hasText: 'Phiên chat mới' }).click()

  await expect(title).toHaveText('Trợ lý tạo mới')
  expect(closeSessionCalled).toBe(false)
  // Two sessions now → the header grows arrows and a counter.
  await expect(win.locator('.nl-chat-session-counter')).toHaveText('2/2')
  // Choosing an item closes the menu behind it.
  await expect(win.locator('.nl-chat-composer-menu')).toHaveCount(0)
})

test('nl chat: the + menu leads the input row and opens upward (capture)', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('.nl-chat-fab').click()

  const win = page.locator('.nl-chat-window')
  await expect(win).toBeVisible({ timeout: 15_000 })

  // No standalone paperclip is left anywhere in the window.
  await expect(win.locator(`.icon-btn[title="Đính kèm tập tin"]`)).toHaveCount(0)

  // "+" sits at the head of the input row, to the left of the text box.
  const add = win.locator('.nl-chat-composer-add > button')
  const textarea = win.locator('.nl-chat-input-row textarea')
  const addBox = (await add.boundingBox())!
  const inputBox = (await textarea.boundingBox())!
  expect(addBox.x).toBeLessThan(inputBox.x)

  // Shrink the window to its floor: the menu is at its most likely to spill.
  const grip = (await win.locator('.nl-chat-resize.is-tl').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + 900, grip.y + 900, { steps: 8 })
  await page.mouse.up()

  await add.click()
  const menu = win.locator('.nl-chat-composer-menu')
  await expect(menu).toBeVisible()

  // Opens UPWARD off the trigger — the composer sits at the bottom edge of the
  // window, so a menu dropped below it would fall out of the viewport.
  const trigger = (await add.boundingBox())!
  const menuBox = (await menu.boundingBox())!
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(trigger.y + 1)

  // Fully on screen, and not spilling out the side of the (now smallest) window.
  const viewport = page.viewportSize()!
  const winBox = (await win.boundingBox())!
  expect(menuBox.x).toBeGreaterThanOrEqual(0)
  expect(menuBox.y).toBeGreaterThanOrEqual(0)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(winBox.x + winBox.width + 1)

  // Both items are clickable, not clipped to a sliver.
  for (const item of await menu.locator('.nl-chat-composer-menu-item').all()) {
    const box = (await item.boundingBox())!
    expect(box.width).toBeGreaterThan(80)
    expect(box.height).toBeGreaterThan(10)
  }

  await capture(page, testInfo, 'nl-chat-add-menu-open')
  // Both themes: the info icon must read as blue and the menu must stay legible.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await capture(page, testInfo, 'nl-chat-add-menu-open-dark')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))

  // Attaching from the menu stages a chip on the strip above the input.
  const chooser = page.waitForEvent('filechooser')
  await menu.locator('.nl-chat-composer-menu-item', { hasText: 'Đính kèm tập tin' }).click()
  await (await chooser).setFiles({
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('ghi chú'),
  })

  await expect(win.locator('.nl-chat-chip-name')).toHaveText('note.txt')
  await expect(menu).toHaveCount(0)
  await capture(page, testInfo, 'nl-chat-attachment-chip')

  // Every way out of the menu works — the pattern it copies its look from has
  // no dismissal at all, so this is the part most likely to be missing.
  await add.click()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  await add.click()
  await expect(menu).toBeVisible()
  await win.locator('.nl-chat-header').click()
  await expect(menu).toHaveCount(0)
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

test('nl chat: an unsubmitted draft survives switching to a step chat and back', async ({ page }, testInfo) => {
  // The bug this task fixes: typing into the creation chat, opening a step's
  // chat, and finding no way back to what was typed. Nothing is ever sent, so
  // no job is submitted against the shared e2e runner.
  await page.route(/\/api\/tasks\/[^/]+\/chat/, (route) => {
    const url = new URL(route.request().url())
    route.fulfill({
      json: {
        taskId: 'DEMO-1',
        stepId: url.searchParams.get('stepId'),
        sessionId: 'sess-switch',
        transcriptFound: true,
        total: 1,
        turns: [{ index: 0, role: 'user', text: 'chạy step design' }],
        running: null,
        runner: { id: 'runner-e2e', name: 'Runner E2E', enabled: true },
        canSend: true,
        queued: false,
      },
    })
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('.task-row', { hasText: 'DEMO-1' }).click()

  // Session A: the creation assistant, with a draft left unsent.
  await page.locator('.nl-chat-fab').click()
  const win = page.locator('.nl-chat-window')
  await expect(win).toBeVisible({ timeout: 15_000 })
  // Every open session stays mounted, so the composer must be addressed through
  // the visible session — two textareas exist as soon as there are two sessions.
  const composer = win.locator('.nl-chat-session:visible .nl-chat-input-row textarea')
  const draft = 'tạo task sửa bug đăng nhập — chưa gửi'
  await composer.fill(draft)

  // Session B: a step's runner chat, opened from the pipeline node.
  const node = page.locator('.pnode', { hasText: 'Design' }).first()
  await expect(node).toBeVisible({ timeout: 15_000 })
  await node.locator('.pnode-chat-btn').click()
  await expect(win.locator('.nl-chat-title')).toContainText('DEMO-1')

  // The arrows appear once there is more than one session.
  const counter = win.locator('.nl-chat-session-counter')
  await expect(counter).toHaveText('2/2')
  await capture(page, testInfo, 'nl-chat-two-sessions')

  // Back to session A — the draft is still there, untouched.
  await win.locator('.icon-btn[title="Phiên trước"]').click()
  await expect(win.locator('.nl-chat-title')).toHaveText('Trợ lý tạo mới')
  await expect(counter).toHaveText('1/2')
  await expect(composer).toHaveValue(draft)

  // Forward again lands back on the step chat, and wraps around from the end.
  await win.locator('.icon-btn[title="Phiên sau"]').click()
  await expect(win.locator('.nl-chat-title')).toContainText('DEMO-1')
  await win.locator('.icon-btn[title="Phiên sau"]').click()
  await expect(win.locator('.nl-chat-title')).toHaveText('Trợ lý tạo mới')
})

test('nl chat: × hides the window, with one session and with several', async ({ page }) => {
  // The session registry drops the closed session AND the window must go away.
  // Re-seeding the registry once it empties must not bounce the window open.
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const win = page.locator('.nl-chat-window')
  const closeBtn = win.locator('.nl-chat-icon-btn[title="Đóng"]')

  await page.locator('.nl-chat-fab').click()
  await expect(win).toBeVisible({ timeout: 15_000 })
  await closeBtn.click()
  await expect(win).toBeHidden()

  // Same with more than one session: closing one leaves the window hidden, not
  // re-pointed at a neighbour and shown again.
  await page.locator('.nl-chat-fab').click()
  await expect(win).toBeVisible()
  await win.locator('.nl-chat-session:visible .nl-chat-composer-add > button').click()
  await win.locator('.nl-chat-composer-menu-item', { hasText: 'Phiên chat mới' }).click()
  await expect(win.locator('.nl-chat-session-counter')).toHaveText('2/2')
  await closeBtn.click()
  await expect(win).toBeHidden()
})

test('nl chat: the info popover carries the dashboard connection state in builder mode', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('.nl-chat-fab').click()

  const win = page.locator('.nl-chat-window')
  await expect(win).toBeVisible({ timeout: 15_000 })

  // The connection dot is gone from the header; what it said now lives in the
  // info popover, so the signal is not lost. The icon leads the header and is
  // drawn in --accent (blue) rather than the muted default of `.icon-btn`.
  await expect(win.locator('.nl-chat-badge')).toHaveCount(0)
  await expect(win.locator('.nl-chat-header > :first-child')).toHaveClass(/nl-chat-info/)

  const [iconColor, accent] = await win.evaluate((el) => {
    const btn = el.querySelector('.nl-chat-info .icon-btn')!
    const probe = document.createElement('div')
    probe.style.color = 'var(--accent)'
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return [getComputedStyle(btn).color, resolved]
  })
  expect(iconColor).toBe(accent)

  await win.locator('.nl-chat-info').hover()
  const popover = win.locator('.nl-chat-info-popover')
  await expect(popover).toBeVisible()
  await expect(popover).toContainText('Kết nối')
  await expect(popover).toContainText('Dashboard đang kết nối')
})
