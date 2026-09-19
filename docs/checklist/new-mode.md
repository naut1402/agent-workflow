# Checklist — thêm mode mới ở FE shell

- [ ] **Export đúng tên `registerMode(registry: ModeRegistry): void`** — glob ở `main.ts` gọi cố định `mod.registerMode(...)`.
- [ ] **`key` duy nhất** — trùng thì `registerMode()` throw lúc khởi động (fail-fast).
- [ ] **`order` duy nhất**, phù hợp vị trí mong muốn trong sidebar.
- [ ] **`labelKey` (+ `titleKey`) trỏ đúng key** đã có trong `plugins/i18n/locales/common/{vi,en}.ts` → `modes.*`.
- [ ] **`icon` khớp tên đã đăng ký** trong `RailIcon.vue`.
- [ ] **Import `panel` trực tiếp** ở top-level, không lazy-load.
- [ ] **`bindings(ctx)` chỉ lấy state đã có trong `ShellContext`**; cần state mới thì thêm đúng 1 dòng vào `shellContext`.
- [ ] **Ẩn/hiện động qua `visible(ctx)`**, không tự thêm `v-if` riêng trong `App.vue`.
- [ ] **Khai `descriptionKey` + `maturity`** (và `defaultEnabled: false` nếu mode chưa hoàn thiện) — group "Chế độ" trong Settings đọc thẳng từ đây.
- [ ] **Không tự đọc `settings.modes` trong feature** — quyết định hiển thị là việc của `canAccessMode` ở shell.
- [ ] **Không sửa `src/frontend/main.ts`** — thấy cần sửa nghĩa là đang làm sai convention.
- [ ] **Cập nhật `MODE_DEFS` trong `App.test.ts`** để mode mới được cover trong cả 3 test lặp qua `MODE_DEFS`.
- [ ] **Giữ xanh trước khi PR** — `vue-tsc --noEmit`, `vitest run tests/src/App.test.ts`, và test riêng của feature.

Quy ước 3 lớp (Container/ModeRegistry/registerMode), field `ModeEntry`, `ShellContext`, lớp truy cập mode: [`docs/agent-rules/mode-registry-guideline.md`](../agent-rules/mode-registry-guideline.md).
