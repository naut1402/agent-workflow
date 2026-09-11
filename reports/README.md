# reports/ — tầng nhẹ của coverage

Dữ liệu mà **cả người và CI** đọc để biết coverage đang ở đâu.

| File | Ai đọc | Vai trò |
|---|---|---|
| `coverage-baseline.json` | máy (`.github/scripts/coverage-gate.ts` · `test-anchor.ts`) | **Mốc tham chiếu** mức phủ của version + **neo SHA** của lượt suite xanh. 🚫 Không phải cổng — cổng chặn merge gác **nợ test theo task** |
| `coverage-history.md` | người | Log append: mỗi lượt CI ghi mốc một dòng. Sau khi bỏ `max()`, đây là chỗ **duy nhất** còn lưu các mốc cũ |
| `<x.y.z>/coverage-summary.json` | người + máy | Snapshot theo version |

## Khoá của `coverage-baseline.json`

| Khoá | Nghĩa |
|---|---|
| `frontend.{lines,statements,functions,branches}` · `backend.lines` | Số của **lượt ghi gần nhất** (ghi đè, 🚫 không `max()`). Mốc để đọc xu hướng, 🚫 không phải ngưỡng |
| `updated_at` | Lượt CI cuối đã cập nhật file |
| `source_ref` · `test_ref` | **Tên branch** của cặp ref đã chạy (tên branch di chuyển được) |
| `source_sha` · `test_sha` | **Neo**: cặp commit (dòng source / dòng test) mà suite đã **xanh** trên |

## Bất biến

- **Chỉ commit tầng nhẹ.** Report thô của một lượt chạy là ~7,7 MB nén, gần gấp
  đôi toàn bộ history của repo. `coverage/` HTML · `playwright-report/` ·
  `test-results/` đi Release asset, không vào git.
- **Mốc ghi đè, 🚫 không `max()`.** `coverage-gate --update` ghi số của **lượt
  này**, kể cả khi thấp hơn. Mốc mô tả lượt gần nhất, không phải mức cao nhất từng
  đạt — nhờ vậy 🚫 không còn lý do nào để sửa file này bằng tay. Chỉ số mà lượt đó
  không đo được thì **giữ giá trị cũ**, và lượt đó in cảnh báo riêng.
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
  lúc thư mục này được dựng (trước khi tách), nên mọi workflow đều lấy `reports/` từ
  dòng test bằng `git archive <ref-test> reports` — 🚫 không đọc bản của dòng source.
  Dòng test mang cây đầy nên hai bản cùng tồn tại; đọc bản đóng băng là đối chiếu với
  một **neo trỏ về cây khác**, tức xanh giả.

Quy ước đầy đủ: [`docs/agent-rules/testing.md`](../docs/agent-rules/testing.md) §6.
