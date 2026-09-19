# Quy ước — triết lý không-regression

- **Trước khi đụng code production** — viết characterization/golden test trên hành vi hiện tại (pure fn + API response snapshot qua `app.request`), rồi refactor dưới nền xanh đó.
- **Logic/module mới hoàn toàn** — test-first (TDD thật).
- **Test fail sau khi sửa code** (kể cả lỗi chỉ lộ ở CI) — điều tra **root cause**, sửa code sản phẩm. Không mock/stub để né qua đường code đang lỗi.
- **Mock chỉ hợp lệ cho phụ thuộc ngoài** (API, thư viện nặng/không chạy được dưới jsdom) đã hợp lý từ đầu — không dùng mock để thay cho việc sửa bug vừa phát hiện.

Bối cảnh (runner, dòng test kép, coverage gate): [`docs/agent-rules/testing.md`](../agent-rules/testing.md).
