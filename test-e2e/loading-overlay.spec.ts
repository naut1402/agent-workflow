import { test, expect, type Locator, type Page } from '@playwright/test'
import { capturePage } from './_capture'

/**
 * E2E cho lớp CHẶN của loading overlay — bảng §5 của `test-spec.md`.
 *
 * Suite vitest khoá được *thời điểm* node overlay có mặt, nhưng 🚫 KHÔNG nói
 * được gì về việc nó phủ tới đâu: jsdom không có layout cũng không có
 * hit-testing, nên một `div` `inset: 0` ở đó không ngăn `click` xuống phần tử
 * bên dưới. Ba điều chỉ kiểm được ở trình duyệt thật, và cả ba nằm ở đây:
 *
 * 1. Overlay phủ ĐÚNG vùng cuộn, kể cả khi vùng đó đã cuộn xuống đáy. Đây là
 *    điểm hỏng của finding F1: neo overlay vào chính hộp cuộn thì `inset: 0`
 *    lấy cỡ bằng padding box nhưng neo vào gốc NỘI DUNG — cuộn xuống là overlay
 *    trôi ra khỏi vùng nhìn thấy, để hở toàn bộ form.
 * 2. Overlay thật sự chặn con trỏ (hit-testing).
 * 3. Nút đóng ở `.modal-head` KHÔNG bị phủ — người dùng luôn thoát được.
 *
 * Chọn `McpServerDialog` làm mẫu: form dài nhất nên `.modal-body` chắc chắn
 * tràn ở viewport thấp, và ca này cuộn xuống đáy rồi mới bấm Lưu (ở slot
 * `footer` của `CDialog`, ngoài overlay) — đúng tình huống mà F1 làm hỏng.
 */

const MCP_LABEL = 'E2E overlay probe'

/**
 * 🚫 Không `waitForLoadState('networkidle')`: dashboard giữ một stream SSE mở
 * suốt phiên nên "mạng rảnh" không bao giờ tới.
 */
async function openMcpTab(page: Page) {
  await page.goto('/')
  const entry = page.locator('button[title="Runner Config"]')
  await expect(entry).toBeVisible({ timeout: 30_000 })
  await entry.click()
  await expect(page.locator('.runner-config')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('tab', { name: 'MCP', exact: true }).click()
  await expect(page.locator('.mcp-panel')).toBeVisible({ timeout: 10_000 })
}

async function removeIfPresent(page: Page, label: string) {
  const rows = page.locator('.mcp-list li').filter({ hasText: label })
  for (let left = await rows.count(); left > 0; left--) {
    page.once('dialog', (d) => d.accept())
    await rows.first().getByRole('button', { name: 'Xóa MCP server' }).click()
    await expect(rows).toHaveCount(left - 1, { timeout: 10_000 })
  }
}

/** Phần tử thật sự nhận click tại tâm của `target` — câu trả lời của hit-testing. */
async function topElementAtCenterOf(page: Page, target: Locator): Promise<string> {
  const box = await target.boundingBox()
  expect(box, 'phần tử phải có bounding box').not.toBeNull()
  return page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return el ? `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` : 'none'
    },
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
  )
}

test('overlay phủ đúng vùng cuộn, chặn con trỏ, và chừa nút đóng (capture)', async ({
  page,
}, testInfo) => {
  // Viewport thấp để `.modal-body` chắc chắn tràn → có cái để cuộn. Toàn bộ giá
  // trị của ca này nằm ở chỗ "đã cuộn xuống đáy rồi mới bận".
  await page.setViewportSize({ width: 1280, height: 600 })
  await openMcpTab(page)
  await removeIfPresent(page, MCP_LABEL)

  await page.getByRole('button', { name: '+ Thêm MCP server' }).click()
  const dialog = page.getByRole('dialog', { name: 'Thêm MCP server' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Tên hiển thị').fill(MCP_LABEL)
  await dialog.getByLabel('Command').fill('npx')

  // Giữ request lưu treo để quan sát trạng thái bận. Nhả ở cuối ca.
  let releaseSave: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  await page.route('**/api/mcp-servers**', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await held
    await route.continue()
  })

  const body = dialog.locator('.modal-body')
  const host = dialog.locator('.c-loading-host')
  const overlay = dialog.locator('.c-loading-overlay')

  // Chỗ neo phải nằm NGOÀI hộp cuộn, và phải bọc hộp cuộn.
  await expect(host).toHaveCount(1)
  await expect(host.locator('.modal-body')).toHaveCount(1)
  await expect(body.locator('.c-loading-host')).toHaveCount(0)

  // Cuộn xuống đáy — đây là trạng thái mà bản implement đầu làm overlay trôi mất.
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  const scroll = await body.evaluate((el) => ({
    top: el.scrollTop,
    overflow: el.scrollHeight - el.clientHeight,
  }))
  expect(scroll.overflow, '.modal-body phải thật sự tràn, nếu không ca này không đo gì cả').toBeGreaterThan(0)
  expect(scroll.top, 'phải cuộn được xuống đáy').toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Lưu MCP server' }).click()

  // `delayMs` = 150 ms: node chặn có mặt ngay, scrim/icon mới là thứ chờ.
  await expect(overlay).toHaveCount(1)
  await expect(overlay).toHaveClass(/is-visible/, { timeout: 5_000 })

  // (0) Bất biến gốc, và là thứ thật sự quyết định: containing block của overlay
  // phải là `.c-loading-host`, KHÔNG phải hộp cuộn. Hộp cuộn mà `position:
  // relative` thì `inset: 0` neo vào gốc nội dung — chính là F1. Mệnh đề này
  // đúng kể cả khi nội dung ngắn, nên nó bắt lỗi sớm hơn phép đo hình học dưới.
  expect(await body.evaluate((el) => getComputedStyle(el).position)).toBe('static')
  expect(await host.evaluate((el) => getComputedStyle(el).position)).toBe('relative')

  // (1) Overlay phủ đúng vùng cuộn, đo ở TOẠ ĐỘ MÀN HÌNH sau khi đã cuộn.
  const overlayBox = (await overlay.boundingBox())!
  const bodyBox = (await body.boundingBox())!
  expect(overlayBox).not.toBeNull()
  expect(Math.abs(overlayBox.x - bodyBox.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(overlayBox.y - bodyBox.y)).toBeLessThanOrEqual(2)
  expect(Math.abs(overlayBox.width - bodyBox.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(overlayBox.height - bodyBox.height)).toBeLessThanOrEqual(2)

  // (2) Chặn con trỏ thật: phần tử trên cùng tại tâm ô Command là overlay, và
  // click vào đó không đưa được focus xuống input.
  const commandInput = dialog.getByLabel('Command')
  await expect(commandInput).toBeVisible()
  expect(await topElementAtCenterOf(page, commandInput)).toContain('c-loading-overlay')

  const inputBox = (await commandInput.boundingBox())!
  await page.mouse.click(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2)
  expect(
    await commandInput.evaluate((el) => el === document.activeElement),
    'click phải bị overlay nuốt, không rơi xuống input',
  ).toBe(false)

  // (3) Nút đóng ở `.modal-head` nằm NGOÀI overlay — vẫn còn đường thoát.
  const closeBtn = dialog.locator('.modal-head button').first()
  await expect(closeBtn).toBeVisible()
  expect(await topElementAtCenterOf(page, closeBtn)).not.toContain('c-loading-overlay')

  await capturePage(page, testInfo, 'loading-overlay-busy')

  // Nhả request → overlay biến mất, không kẹt.
  releaseSave()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  await expect(page.locator('.c-loading-overlay')).toHaveCount(0)

  await removeIfPresent(page, MCP_LABEL)
})

test('scrim đảo theo theme và `prefers-reduced-motion` tắt animation', async ({ page }) => {
  // Hai mệnh đề này là thuần CSS-resolution: jsdom không resolve biến CSS cũng
  // không áp media query, nên vitest 🚫 không nói được gì về chúng.
  await openMcpTab(page)

  const scrimOf = (theme: 'light' | 'dark') =>
    page.evaluate((t) => {
      const prev = document.documentElement.dataset.theme
      document.documentElement.dataset.theme = t
      const v = getComputedStyle(document.documentElement).getPropertyValue('--overlay-scrim').trim()
      if (prev) document.documentElement.dataset.theme = prev
      return v
    }, theme)

  const dark = await scrimOf('dark')
  const light = await scrimOf('light')
  expect(dark).not.toBe('')
  expect(light).not.toBe('')
  expect(light, 'scrim phải đảo theo theme, không dùng chung một giá trị').not.toBe(dark)

  // `prefers-reduced-motion: reduce` ⇒ icon xoay đứng yên.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.className = 'c-spin'
    document.body.appendChild(probe)
    const name = getComputedStyle(probe).animationName
    probe.remove()
    return name
  })
  expect(reduced).toBe('none')

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const normal = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.className = 'c-spin'
    document.body.appendChild(probe)
    const name = getComputedStyle(probe).animationName
    probe.remove()
    return name
  })
  expect(normal).toBe('c-spin')
})

test('request lỗi cũng không kẹt loading', async ({ page }) => {
  await openMcpTab(page)
  await removeIfPresent(page, MCP_LABEL)

  await page.getByRole('button', { name: '+ Thêm MCP server' }).click()
  const dialog = page.getByRole('dialog', { name: 'Thêm MCP server' })
  await dialog.getByLabel('Tên hiển thị').fill(MCP_LABEL)
  await dialog.getByLabel('Command').fill('npx')

  await page.route('**/api/mcp-servers**', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"E2E conflict"}' })
  })

  const save = page.getByRole('button', { name: 'Lưu MCP server' })
  await save.click()

  // AC2 ở mức người dùng thấy: overlay tắt, dialog còn đó, nút bấm lại được.
  await expect(page.locator('.c-loading-overlay')).toHaveCount(0, { timeout: 10_000 })
  await expect(dialog).toBeVisible()
  await expect(save).toBeEnabled()
  await expect(dialog).toContainText('E2E conflict')
})

test('SettingsDialog: overlay neo ở .settings-layout, phủ pane đã cuộn, chừa nút đóng', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 })
  await page.goto('/')
  await expect(page.locator('.tasklist')).toBeVisible({ timeout: 15_000 })
  await page.locator('button[title="Cài đặt"]').click()
  const dialog = page.getByRole('dialog', { name: 'Cài đặt' })
  await expect(dialog).toBeVisible()

  const host = dialog.locator('.settings-layout.c-loading-host')
  const pane = dialog.locator('.settings-pane.modal-body')
  const overlay = dialog.locator('.c-loading-overlay')
  await expect(host).toHaveCount(1)
  await expect(host.locator('.settings-pane.modal-body')).toHaveCount(1)

  await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  const scroll = await pane.evaluate((el) => ({ top: el.scrollTop, overflow: el.scrollHeight - el.clientHeight }))
  expect(scroll.overflow, '.settings-pane phải thật sự tràn, nếu không ca này không đo gì cả').toBeGreaterThan(0)
  expect(scroll.top).toBeGreaterThan(0)

  let releaseSave: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  await page.route('**/api/recovery-config', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback()
    await held
    await route.continue()
  })

  const recovery = dialog.getByLabel('Bật tự phục hồi')
  await expect(recovery).toBeVisible()
  const before = await recovery.isChecked()
  await recovery.click()

  await expect(overlay).toHaveCount(1)
  await expect(overlay).toHaveClass(/is-visible/, { timeout: 5_000 })

  expect(await pane.evaluate((el) => getComputedStyle(el).position)).toBe('static')
  expect(await host.evaluate((el) => getComputedStyle(el).position)).toBe('relative')
  expect(await host.evaluate((el) => getComputedStyle(el).flexDirection)).toBe('row')

  const overlayBox = (await overlay.boundingBox())!
  const hostBox = (await host.boundingBox())!
  const paneBox = (await pane.boundingBox())!
  expect(Math.abs(overlayBox.x - hostBox.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(overlayBox.y - hostBox.y)).toBeLessThanOrEqual(2)
  expect(Math.abs(overlayBox.width - hostBox.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(overlayBox.height - hostBox.height)).toBeLessThanOrEqual(2)
  expect(paneBox.y).toBeGreaterThanOrEqual(overlayBox.y - 2)
  expect(paneBox.y + paneBox.height).toBeLessThanOrEqual(overlayBox.y + overlayBox.height + 2)

  expect(await topElementAtCenterOf(page, recovery)).toContain('c-loading-overlay')
  const closeBtn = dialog.locator('.modal-head .modal-close')
  expect(await topElementAtCenterOf(page, closeBtn)).not.toContain('c-loading-overlay')

  releaseSave()
  await expect(overlay).toHaveCount(0, { timeout: 10_000 })
  await expect(recovery).toBeEnabled()
  if ((await recovery.isChecked()) !== before) {
    await page.unroute('**/api/recovery-config')
    await recovery.click()
    await expect(recovery).toBeChecked({ checked: before, timeout: 10_000 })
  }
})
