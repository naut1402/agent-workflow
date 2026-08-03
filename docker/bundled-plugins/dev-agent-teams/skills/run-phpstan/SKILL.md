---
name: run-phpstan
description: Quy trình chạy PHPStan và đọc kết quả cho hanbai-product. Reference skill — dùng nội bộ bởi implementer agent.
user-invocable: false
---

# Run PHPStan

Hướng dẫn chạy PHPStan và xử lý kết quả trong dự án 楽楽販売.

## Chạy PHPStan

```bash
# Chạy toàn bộ project
vendor/bin/phpstan analyse --memory-limit=512M

# Chạy chỉ files đã sửa
vendor/bin/phpstan analyse path/to/file.php --memory-limit=512M

# So sánh với baseline (nếu có)
vendor/bin/phpstan analyse --generate-baseline phpstan-baseline.neon
```

<!-- TODO: điền lệnh thực tế của dự án, config level, path -->

## Đọc kết quả

Mỗi lỗi PHPStan có format:
```
 ------ -------------------------------------------------------------------
  Line   src/Path/To/File.php
 ------ -------------------------------------------------------------------
  42     Variable $result might not be defined.
 ------ -------------------------------------------------------------------
```

## Fix patterns phổ biến

| Lỗi | Pattern fix |
|---|---|
| `Variable $x might not be defined` | Khởi tạo biến trước vòng lặp/điều kiện: `$x = null;` |
| `Nullable type: cannot call method on null` | Thêm null check: `if ($obj !== null) { $obj->method(); }` |
| `Return type mismatch` | Fix return type hint hoặc thêm cast |
| `Method not found on type X\|Y` | Narrow type trước: `if ($obj instanceof X) { ... }` |
| `Dead code` | Xóa code không bao giờ chạy hoặc restructure logic |

## Mục tiêu

- **0 new errors** so với branch `main`.
- Không bắt buộc fix lỗi cũ (pre-existing errors) trừ khi trong scope của task.
- Nếu không thể fix một lỗi PHPStan mà không break logic: ghi vào `phpstan.md` phần "Known issues" và giải thích lý do.

## Format `phpstan.md`

```markdown
# PHPStan Report — <task-id>

## Kết quả
- New errors: <số lỗi mới>
- Pre-existing errors: <không tính>
- Status: CLEAN / HAS_NEW_ERRORS

## New errors (nếu có)
| File | Line | Error | Fixed? |
|---|---|---|---|
| path/file.php | 42 | Variable $x might not be defined | ✅ |

## Known issues (không thể fix)
<Giải thích nếu có lỗi không fix được trong scope>
```
