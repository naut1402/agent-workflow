import type { Page } from '@playwright/test'

const STORAGE_KEY = 'dev-dashboard-app-settings'

/**
 * [T0c6725e9] Mở sẵn mọi section của viewer artifact cho các spec thao tác vào
 * **bên trong** section (bấm link, dblclick sửa, bôi đen chọn chữ).
 *
 * Từ task này accordion mặc định BẬT ⇒ tài liệu mở ra đóng hết, nên nội dung tuy
 * vẫn có trong DOM nhưng nằm trong `<details>` đóng: locator resolve được mà không
 * actionable, và spec đỏ với message `Test timeout` thay vì nói đúng lý do.
 *
 * Seed đặt qua `addInitScript` nên phải gọi **trước** `page.goto('/')` — preference
 * được đọc một lần lúc app khởi động.
 *
 * 🚫 Không dùng cho spec đang chấm chính trạng thái mặc định — ở đó việc đóng hết
 * mới là thứ cần assert.
 */
export async function seedArtifactSectionsExpanded(page: Page) {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        /* ignore — private mode / quota */
      }
    },
    {
      key: STORAGE_KEY,
      value: JSON.stringify({
        artifactSectionAccordion: false,
        artifactSectionDefault: 'expanded',
      }),
    },
  )
}
