# Todo — Tfb77cf90-P9

- **Issue / epic:** #448 (sub issue của #450)
- **Loại nợ:** readme
- **Branch / PR tạo nợ:** `dev/1.2.1/Tfb77cf90-P9_agent-draft-generator`
- **Ngày tạo:** 2026-10-11

### Vì sao hoãn

Root `README.md` còn mô tả wizard sinh bản nháp agent ở FE, nhưng wizard đã gỡ ở `39d29e6` (#353). Backend vẫn giữ route `POST /api/custom-agents/generate` (không còn caller trong repo, chỉ gọi được qua HTTP client ngoài) — #448 chỉ tách `generate.ts` thành `DraftGenerator`, không đổi hành vi. Agent không được sửa root `README.md` (`git-pr.md` §7.2.2), nên ghi đề xuất chờ người duyệt.

Đề xuất:

| Vị trí | Hiện tại | Đề xuất |
|---|---|---|
| `README.md:39` — mục **Agent editor** | "… template bước workflow, wizard sinh bản nháp từ mô tả tiếng Việt (cần `ANTHROPIC_API_KEY`)." | "… template bước workflow." — bỏ vế wizard; nếu muốn giữ ý thì ghi "API `POST /api/custom-agents/generate` sinh bản nháp từ mô tả (dùng `ANTHROPIC_API_KEY` nếu có, không thì heuristic)" và trỏ [`docs/docker.md`](../../docker.md) |
| `README.md:31` — mục **Tích hợp AI** (liên quan) | "Anthropic SDK cho wizard sinh agent bằng ngôn ngữ tự nhiên; …" | Bỏ vế wizard (nhánh này gọi `fetch` thẳng Messages API, không qua SDK); giữ phần MCP server |

Lý do: wizard FE đã gỡ ở `39d29e6`; `docs/docker.md:11` vẫn đúng (mô tả route, không nhắc wizard) nên không cần sửa.

### Việc cần làm khi đối ứng

- [ ] Người duyệt sửa (hoặc bác bỏ) `README.md:39` theo đề xuất trên
- [ ] Người duyệt xem xét `README.md:31` cùng lúc
- [ ] Xoá file nợ này; xoá **cả thư mục** `docs/todo/` khi không còn file nợ nào

### Liên kết

- #448 · #450 · commit gỡ wizard `39d29e6` (#353)
