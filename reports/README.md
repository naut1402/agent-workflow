# reports/ — tầng nhẹ của coverage

Dữ liệu mà **cả người và CI** đọc để biết coverage đang ở đâu.

| File | Ai đọc | Vai trò |
|---|---|---|
| `coverage-baseline.json` | máy (`.github/scripts/coverage-gate.ts`) | **Cổng**. Coverage tụt quá dung sai so với file này là đỏ |
| `coverage-history.md` | người | Log append: mỗi lượt CI cập nhật baseline một dòng |
| `<x.y.z>/coverage-summary.json` | người + máy | Snapshot theo version |

## Bất biến

- **Chỉ commit tầng nhẹ.** Report thô của một lượt chạy là ~7,7 MB nén, gần gấp
  đôi toàn bộ history của repo. `coverage/` HTML · `playwright-report/` ·
  `test-results/` đi Release asset, không vào git.
- **Baseline chỉ đi lên.** `coverage-gate --update` lấy `max(cũ, mới)`. Muốn hạ
  (vd xoá hẳn một module) thì sửa file bằng tay trong một PR có ghi lý do.
- **Chỗ ở cuối cùng của thư mục này là dòng test** (`test/main`). Nó đang nằm ở
  dòng source vì cổng coverage được dựng **trước** khi cắt `tests/` — có baseline
  đo trên cây còn nguyên thì mới có mốc để so về sau.

Quy ước đầy đủ: [`docs/agent-rules/testing.md`](../docs/agent-rules/testing.md) §6.
