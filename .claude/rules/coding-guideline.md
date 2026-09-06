# Coding guideline

Quy tắc viết code trong repo này, rút gọn cho công cụ AI. Bản đầy đủ cho người đọc: `docs/implement/coding-convention.md`.

- Đặt tên thư mục/module theo **vai trò kiến trúc** và theo **nội dung còn lại sau khi đổi**, không theo "đồ dùng chung", không giữ tên lịch sử migration.
- `*Utils` = thao tác trên kiểu dữ liệu thuần; `*Lib` = biên bọc thư viện bên thứ ba. Đặt sai tên là đặt sai chỗ.
- Module dùng chung cho cả FE và BE **không** được top-level import `node:*` — bundler FE sẽ kéo theo.
- `business/` **không** import trực tiếp `node:fs` / `node:path`; đi qua `fileHelper`. Cần API fs mới: mở rộng `fileHelper` + khai overload TypeScript **trước**, migrate call site sau, rồi `bun run typecheck`.
- File `.js` thuần import `.ts`: kiểm tra Vite resolve được trước khi tin là CI xanh.
- Đổi alias (`@configs`, …): cập nhật `tsconfig` / `vitest` / ESLint / tài liệu **cùng một đợt**.
- Đợt rename lớn: giữ alias cũ ổn định một thời gian, cập nhật tài liệu ngay trong đợt đó.
- Preference cần chặn I/O phía server → lưu vào `settings.json` (DashboardSettings), không dùng AppSettings localStorage.

Nguồn: `docs/implement/coding-convention.md`.
