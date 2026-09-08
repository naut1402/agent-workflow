import { test, expect } from '@playwright/test'
import { capturePage } from './_capture'

// E2E capture for the features/pipeline-editor module. Switches to the Pipeline
// Editor mode and confirms the VueFlow canvas mounts (proves PipelineEditor +
// its sub-panels still wire up after the feature-module migration).

async function openEditor(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Pipeline Editor' }).click()
  await expect(page.locator('.vue-flow')).toBeVisible({ timeout: 15_000 })
}

test('pipeline editor mode mounts the canvas (capture)', async ({ page }, testInfo) => {
  await openEditor(page)

  // 1.3 — top bar giờ chỉ còn 2 nút tab Task / Profile; mọi action nằm ở sub-sidebar.
  await expect(page.locator('.editor-toolbar .editor-tab')).toHaveCount(2)
  await expect(page.locator('.editor-target-panel')).toBeVisible()

  // c.1 — Agents / Skills / Rules là 3 mục collapsible cùng cấp, không còn card Catalog.
  await expect(page.locator('.editor-left-sections .editor-section')).toHaveCount(3)
  expect(await page.locator('.catalog-tabs').count()).toBe(0)

  // UX2 (ported from verify-ux): no step-config dialog until a node is selected.
  expect(await page.locator('.step-config-dialog').count()).toBe(0)

  await capturePage(page, testInfo, 'pipeline-editor')
})

// docs/ui-overflow.md — container ngoài KHÔNG cuộn, chỉ lá cuộn và mục cuối phải
// tới được. Tràn được ép bằng viewport thấp; danh sách Rules cần dữ liệu ổn định nên
// fixture có sẵn `test-e2e/fixtures/project/docs/agent-rules/` (không spec nào khác
// đọc rules, nên seed ở đây không kéo theo assert của spec khác).
test('sub-sidebar lists scroll instead of clipping', async ({ page }) => {
  // 560px là chiều cao đủ thấp để cả 3 danh sách tràn nhưng vẫn còn chỗ nhìn thấy
  // mục cuối sau khi cuộn — thấp hơn nữa thì vùng cuộn co lại còn vài px.
  await page.setViewportSize({ width: 1280, height: 560 })
  await openEditor(page)

  // Mở cả 3 section để chúng chia nhau chiều cao còn lại.
  const heads = page.locator('.editor-left-sections .editor-section-head')
  for (let i = 0; i < (await heads.count()); i++) {
    const section = page.locator('.editor-left-sections .editor-section').nth(i)
    if (!(await section.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await heads.nth(i).click()
    }
  }

  // Cả 3 danh sách nạp bất đồng bộ — đo trước khi có dữ liệu thì phép đo vô nghĩa.
  await expect(page.locator('.catalog-item').first()).toBeVisible()
  await expect(page.locator('.rules-item').first()).toBeVisible()

  // Container ngoài KHÔNG được là scroller — đây chính là lỗi "kéo mãi không tới
  // mục cuối" mà task này sửa.
  const outer = page.locator('.editor-left-sections')
  expect(await outer.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)

  for (const [panel, leaf, item] of [
    ['.catalog-panel', '.catalog-list', '.catalog-item'],
    ['.rules-panel', '.rules-scroll', '.rules-item'],
  ] as const) {
    const list = page.locator(leaf).first()
    await expect(list).toBeVisible()

    // Lá là vùng cuộn duy nhất, và nó nằm gọn trong khung panel (không tràn ra ngoài).
    const box = await list.evaluate((el, panelSel) => {
      const p = el.closest(panelSel as string) as HTMLElement
      return {
        overflowY: getComputedStyle(el).overflowY,
        overflows: el.scrollHeight > el.clientHeight,
        spill: Math.round(el.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom),
      }
    }, panel)
    expect(box.overflowY).toBe('auto')
    expect(box.spill).toBeLessThanOrEqual(1)

    // Danh sách nào thực sự tràn thì mục cuối phải tới được bằng cách cuộn. Số agent
    // của fixture thay đổi theo spec khác nên chỉ Rules chắc chắn tràn ở đây.
    if (box.overflows) {
      await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
      await expect(list.locator(item).last()).toBeInViewport()
    }
  }

  // Rules đọc từ `test-e2e/fixtures/project/docs/agent-rules/` (10 file) nên luôn
  // đủ dài để tràn — nếu không thì phép đo ở trên không chứng minh được gì.
  const rules = page.locator('.rules-scroll')
  expect(await rules.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
})

// Ngân sách chiều cao của cột trái: 3 mục mở cùng lúc chia nhau một cột, mỗi mục
// còn phải trả phần cố định cho header + toolbar. Đo trực tiếp chiều cao vùng
// cuộn thay vì chỉ dựa vào `toBeInViewport` — vùng cuộn 8px vẫn "in viewport" khi
// nó chỉ còn đúng phần padding, nên phép đo lỏng không bắt được sụp chiều cao.
test('sub-sidebar keeps every open list usable at a low viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 })
  await openEditor(page)

  const heads = page.locator('.editor-left-sections .editor-section-head')
  const sectionAt = (i: number) => page.locator('.editor-left-sections .editor-section').nth(i)
  async function setOpen(i: number, open: boolean) {
    if ((await sectionAt(i).evaluate((el) => (el as HTMLDetailsElement).open)) !== open) {
      await heads.nth(i).click()
    }
  }

  // Sàn cho vùng cuộn: đủ chứa một item (item catalog ~50px) chứ không chỉ padding.
  const FLOOR = 48

  // Cả 3 mục mở — trường hợp chật nhất. Đo được 60/60/62px ở 560px.
  for (let i = 0; i < 3; i++) await setOpen(i, true)
  await expect(page.locator('.catalog-item').first()).toBeVisible()
  await expect(page.locator('.rules-item').first()).toBeVisible()
  for (const leaf of ['.catalog-list', '.rules-scroll']) {
    for (const h of await page.locator(leaf).evaluateAll((els) =>
      els.map((el) => el.clientHeight),
    )) {
      expect(h).toBeGreaterThanOrEqual(FLOOR)
    }
  }

  // TC-C09 — chỉ mở mục Skills: panel catalog phải giành chiều cao dù mục Agents
  // đang đóng, và danh sách Skills không được thu về 0.
  await setOpen(0, false)
  await setOpen(2, false)
  const skillList = page.locator('.catalog-list').nth(1)
  await expect(skillList).toBeVisible()
  expect(await skillList.evaluate((el) => el.clientHeight)).toBeGreaterThanOrEqual(FLOOR)
})
