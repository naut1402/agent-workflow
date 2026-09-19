# Checklist — thêm feature mới

1. **Tạo `src/features/<name>/`** với `api.ts`, `controller.ts`, `business/`, và (tuỳ) `components`, `composables`, `scripts`, `styles/index.scss`, `locales/{vi,en}.ts`, `schemas/`.
2. **Kế thừa abstract** — controller `extends AbstractController`; business `extends AbstractBusiness`.
3. **Gom `business/` theo nghiệp vụ**; peer chỉ qua `business/index.ts`.
4. **Không sửa `apiServer` registry tay** — để glob nạp.
5. **Schema domain để trong feature**, đừng đẩy vào `src/frontend/configs` trừ shell preference thật sự.
6. **Dùng `*Utils` / `*Lib` / `fileHelper` có sẵn**, mở rộng helper trước khi copy logic.
7. **Business không import trực tiếp `node:fs` / `node:path`.**
8. **Chạy `bun run typecheck` + `bun run build`** nếu đụng cả FE và Node.
9. **Thêm mode ở FE shell** thì theo [`docs/agent-rules/mode-registry-guideline.md`](../agent-rules/mode-registry-guideline.md).

Quy ước: [`docs/convention/feature-architecture.md`](../convention/feature-architecture.md).
