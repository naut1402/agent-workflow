# Styling

← [`../README.md`](../README.md) (Cấp 4 · Code)

Đọc khi thêm style mới xuyên feature, hoặc cần biết vì sao đổi 1 token lại ảnh hưởng toàn bộ giao diện.

| Chủ đề | Chi tiết |
|---|---|
| Entry SCSS | `src/frontend/styles/main.scss` (tokens + scrollbar + shell), import từ `src/frontend/main.ts`. |
| Style theo feature | `src/features/<mode>/styles/` (`common.scss` + `{Component}.scss` + `index.scss`) — **tự nạp** trong `src/frontend/main.ts` qua `import.meta.glob('../features/*/styles/index.scss', { eager: true })`, không liệt kê từng feature trong `main.scss`. |
| Theme / runtime token | `_tokens` / `_shell` là CSS variables trên `:root` nên sửa hàng loạt vẫn ảnh hưởng mọi module. |
| Build | Vite dùng `sass-embedded` + `scss.api = 'modern-compiler'`. |
