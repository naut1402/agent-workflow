---
name: coding-rules
description: Coding conventions và quality standards cho PHP project hanbai-product. Reference skill — dùng nội bộ bởi implementer và reviewer agent.
user-invocable: false
---

# Coding Rules

Quy tắc viết code và tiêu chuẩn chất lượng cho dự án 楽楽販売 (PHP).

## Rule từ project (ưu tiên)

Orchestrator đã nạp rule project và truyền "Rule coding" vào `.dev-team-agent/project-rules.md`. Đọc phần đó trước: nếu có, rule project **ưu tiên hơn** khi xung đột với skill này. Nếu phần coding trống, dùng rule trong skill này làm fallback. (Không tự gọi `read-project-rules` khi chạy trong pipeline.)

## Nguyên tắc cốt lõi

- **Không sửa ngoài scope fix**: Chỉ chỉnh code liên quan trực tiếp đến task. Không refactor cơ hội.
- **PHPStan clean**: 0 new errors so với branch `main`. Không được tạo thêm lỗi PHPStan.
- **Backward compatible**: Không thay đổi interface/signature của method đang được gọi từ nhiều nơi trừ khi design đã xác định rõ.

## Security

| Rule | Mô tả |
|---|---|
| SQL Injection | Luôn dùng prepared statements / PDO binding. Không interpolate biến vào SQL string. |
| XSS | Dùng `htmlspecialchars()` cho tất cả output ra HTML. Không echo trực tiếp input của user. |
| CSRF | Kiểm tra CSRF token cho tất cả POST/PUT/DELETE request. |
| Input validation | Validate và sanitize input tại controller trước khi đưa xuống service. |

## Naming conventions

<!-- TODO: điền theo convention thực tế của dự án -->
- Class: PascalCase
- Method: camelCase
- Variable: camelCase
- Constant: UPPER_SNAKE_CASE
- DB table: snake_case
- DB column: snake_case

## Code style

<!-- TODO: điền theo PSR hoặc standard của dự án -->
- Indentation: 4 spaces
- Max line length: 120 characters
- PHPDoc: bắt buộc cho public method

## PHPStan

- Xem skill `run-phpstan` để biết cách chạy và đọc kết quả.
- Mục tiêu: 0 new errors so với `main`. Không cần fix lỗi cũ trừ khi trong scope.

## Review severity levels

Khi reviewer ghi `review.md`, dùng labels:
- `[must]`: Bắt buộc sửa trước khi merge (security, bug, logic sai)
- `[should]`: Nên sửa (code smell, maintainability)
- `[imo]`: Ý kiến cá nhân, có thể bỏ qua (style preference)

Format comment trong review.md:
```
[must] file/path.php:42 — Dùng prepared statement thay vì string concat
  Suggestion: `$stmt = $pdo->prepare("SELECT * FROM t WHERE id = ?"); $stmt->execute([$id]);`
```
