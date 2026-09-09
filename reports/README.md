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
  phát hành; neo **không còn tồn tại** (force-push) là đỏ, không phải "bỏ qua".
- **Chỗ ở cuối cùng của thư mục này là dòng test** (`test/main`). Nó đang nằm ở
  dòng source vì cổng coverage được dựng **trước** khi cắt `tests/` — có baseline
  đo trên cây còn nguyên thì mới có mốc để so về sau.

Quy ước đầy đủ: [`docs/agent-rules/testing.md`](../docs/agent-rules/testing.md) §6.
