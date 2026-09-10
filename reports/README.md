# reports/ — tầng nhẹ của coverage

Dữ liệu mà **cả người và CI** đọc để biết coverage đang ở đâu.

| File | Ai đọc | Vai trò |
|---|---|---|
| `coverage-baseline.json` | máy (`.github/scripts/coverage-gate.ts` · `test-anchor.ts`) | **Cổng**. Coverage tụt quá dung sai so với file này là đỏ; đồng thời giữ **SHA neo** của lượt đo |
| `coverage-history.md` | người | Log append: mỗi lượt CI cập nhật baseline một dòng |
| `<x.y.z>/coverage-summary.json` | người + máy | Snapshot theo version |

## Khoá của `coverage-baseline.json`

| Khoá | Nghĩa |
|---|---|
| `frontend.{lines,statements,functions,branches}` · `backend.lines` | Số coverage đã chốt — cổng so lượt chạy hiện tại với đây |
| `updated_at` | Lượt CI cuối đã cập nhật file |
| `source_ref` · `test_ref` | **Tên branch** của cặp ref đã chạy (tên branch di chuyển được) |
| `source_sha` · `test_sha` | **Neo**: commit của dòng source / dòng test mà số coverage này đo trên |

## Bất biến

- **Chỉ commit tầng nhẹ.** Report thô của một lượt chạy là ~7,7 MB nén, gần gấp
  đôi toàn bộ history của repo. `coverage/` HTML · `playwright-report/` ·
  `test-results/` đi Release asset, không vào git.
- **Baseline chỉ đi lên.** `coverage-gate --update` lấy `max(cũ, mới)`. Muốn hạ
  (vd xoá hẳn một module) thì sửa file bằng tay trong một PR có ghi lý do.
- **Neo ghi đè, không `max()`.** Neo là *thời điểm*: lượt mới nhất thắng, vì `max()`
  trên chuỗi SHA là vô nghĩa. Cổng `test-anchor.ts` so `source_sha` với head của PR
  phát hành; neo **không tới được** (force-push, commit bị bỏ, hoặc workspace không
  fetch được theo SHA) là đỏ, không phải "bỏ qua".
- **Lượt ghi số mà không khai neo thì neo cũ bị BỎ.** `coverage-gate --update` không
  kèm `--source-sha`/`--test-sha` sẽ xoá neo đang có và in cảnh báo. Vì số coverage
  vừa đổi theo lượt mới, còn neo cũ mô tả cây khác — giữ lại là để cổng neo so head
  PR với cây đó rồi in *"neo khớp"*. Không có neo cho ra `no-anchor`, một cảnh báo
  **nhìn thấy được**; neo lệch cho ra một kết luận **sai**. Chạy tay thì truyền đủ
  hai cờ, hoặc chấp nhận về `no-anchor` cho tới lượt CI kế tiếp.
- **Neo phải là SHA đầy đủ (40 hex).** Cả đường ghi (`normalizeSha`) và đường đọc
  (`readAnchor`) đều chặn SHA viết tắt: cổng so bằng **chuỗi**, nên `a3b60a5` sẽ
  luôn lệch dù git resolve được nó. Sửa tay mà ghi SHA tắt là lỗi công cụ (exit 2),
  không phải `no-anchor`.
- **Nguồn sự thật của thư mục này là dòng test.** Bản trên dòng source đóng băng từ
  lúc cổng coverage được dựng (trước khi tách), nên mọi cổng đều lấy `reports/` từ
  dòng test bằng `git archive <ref-test> reports` — 🚫 không đọc bản của dòng source.
  Dòng test mang cây đầy nên hai bản cùng tồn tại; chấm theo bản đóng băng là chấm
  theo số cũ, tức xanh giả.

Quy ước đầy đủ: [`docs/agent-rules/testing.md`](../docs/agent-rules/testing.md) §6.
