# Testing

Quy tắc chọn runner, viết và chạy test. Bản đầy đủ cho người đọc: `docs/implement/test-convention.md`.

- Chọn runner theo I/O **thật** của test: chạm filesystem / network → `bun test`; chạm DOM → `vitest`.
- Test import source theo đuôi `.js` khớp `moduleResolution` của repo.
- Mọi cơ chế auto-load phải có đường dự phòng, và đường dự phòng đó phải có test.
- Test đụng filesystem / registry / agent / plugin: chạy thêm một lượt với env đã tước (`HOME` rỗng, biến plugin trỏ path không tồn tại) — máy dev có sẵn `/opt/bundled-plugins` và `~/.claude/plugins`, CI thì không.
- `bun run test:scope` chọn ra 0 file **không** có nghĩa "đã xanh", mà là "chỗ này chưa ai test".
- Thêm / đổi thư mục test → sinh lại bảng bằng `bun run test:scope --catalog` và cập nhật `docs/implement/test-convention.md` §2.1 trong cùng thay đổi.
- Môi trường: repo **không** còn thư mục `plugins/` ở root. Muốn bản agent trong repo thắng cache cũ khi chạy local, đặt `DEV_TEAM_BUNDLED_PLUGINS` trỏ tới cây `<root>/dev-agent-teams/agents`.

Nguồn: `docs/implement/test-convention.md`.
