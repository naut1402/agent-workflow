# Doc writing

Quy tắc viết tài liệu trong repo này: artifact task (`investigate.md` / `design.md`) và tài liệu dự án (`docs/`, `README.md`).

- `investigate.md` = 6 section decision-first; `design.md` = 7 section. Bản đầy đủ (mục đích từng section, ví dụ, anti-pattern): `docs/implement/doc-writing-convention.md`; bản làm việc rút gọn: `AGENTS.md` §7. Khi hai bên lệch, bản đầy đủ là đúng.
- **Chiều tham chiếu (bắt buộc)**: `docs/**` và `README.md` **không** được trỏ tới `AGENTS.md`, `CLAUDE.md` hay `.claude/rules/**`. Chiều ngược lại (agent → docs) được phép và được khuyến khích.
- Mọi mệnh đề nói về *quan hệ giữa hai tầng* (bên nào đúng khi lệch, khi nào phải cập nhật file nào) viết ở **phía agent**, không viết trong `docs/`.
- Ngoại lệ duy nhất: `docs/template/agents/*.md` — đây là prompt template cho repo **đích**; `AGENTS.md` nhắc trong đó trỏ tới repo đích, không phải repo này.
- Đổi convention → cập nhật `docs/implement/` cùng đợt; đợt tái cấu trúc lớn → bổ sung một đơn vị vào `docs/cookbook/`. Nếu quy ước đó cũng nằm trong `AGENTS.md` / `.claude/rules/` thì cập nhật luôn hai nơi này.
- Tài liệu mô tả hành vi **hiện hành**, không thuật lịch sử; không trích số issue / số PR / tên người / tên agent.
- Kiểm chứng trước khi mở PR: `grep -rn -e 'AGENTS.md' -e 'CLAUDE.md' -e '.claude/rules' docs/ README.md` chỉ còn kết quả trong `docs/template/agents/`.

Nguồn: `docs/implement/doc-writing-convention.md`, `docs/implement/pr-docs-convention.md`.
