# Backend — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho `src/backend/`. Chỉ ghi phần **không tự giải thích được qua tên file**: quirk, giới hạn đã biết, ràng buộc ẩn. Khi sửa, đối chiếu lại với code thật.

---

## 1. Import namespace cho module `node:*`

`lib/fileHelper.ts` import `node:url`, `node:crypto`, `node:util` dạng `import * as …` và chỉ truy cập thuộc tính ở call site.

- **Không named import** `from 'node:*'` cho các module này — Vite viết lại named import thành truy cập thuộc tính lúc module init (`ext["fileURLToPath"]`, `ext["randomBytes"]`), ném lỗi trên browser nếu file lọt vào client graph.
- **`node:fs` / `node:fs/promises` / `node:path` import default** — không nằm trong nhóm bị viết lại kiểu trên.

## 2. Ghi atomic `writeTextFileAtomicSync`

`writeTextFileAtomicSync()` (`lib/fileHelper.ts`) ghi temp `<file>.tmp` rồi rename đè lên file đích.

- **Rename lỗi tạm thời thì thử lại rồi chép đè** — Docker bind mount, share SMB/NFS, thư mục bị antivirus quét có thể trả `EBUSY` / `EPERM` / `EACCES` khi rename đè lên file đã có. `renameOverExisting` thử lại 3 lần cách 20 ms (busy-wait, hàm là sync), hết lượt thì `copyFileSync` đè + xoá temp — các filesystem đó cho phép cách này.
- **`chmodSync` chạy ở cả hai nhánh** — nhánh chép đè giữ mode của file đích đã tồn tại chứ không lấy mode của temp; còn `writeFileSync` không đổi mode của file đã có (file tạo từ lần chạy trước khi có `mode`). Chỉ lệnh `chmodSync` cuối hàm chốt được `mode`.
- **Lỗi `chmodSync` bị nuốt** — win32 / FS không hỗ trợ POSIX mode: nội dung vẫn ghi đúng, luồng không bị chặn. Vì vậy quyền file chỉ là lớp rào phụ; rào chính là `mode` lúc tạo file hoặc vị trí file dưới thư mục hồ sơ người dùng (cùng lý do cho `chmodSafe`).
- **Bản async `writeTextFileAtomic`** — temp mang pid + chuỗi ngẫu nhiên nên hai lần ghi song song không giẫm temp của nhau; không có nhánh thử lại / chép đè như bản sync.
