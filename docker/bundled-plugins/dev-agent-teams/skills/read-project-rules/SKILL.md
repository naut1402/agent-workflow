→---
name: read-project-rules
description: Tìm và nạp convention rule của project (rule coding, rule viết tài liệu, rule review doc, rule test, rule git/PR) theo thứ tự tìm kiếm thống nhất. Dùng khi bất kỳ skill/agent nào cần biết rule của project trước khi viết code, viết tài liệu, tạo test, hay review — hoặc gọi trực tiếp để xem project đang định nghĩa những rule gì và ở đâu.
argument-hint: "[category] — coding | doc-writing | doc-review | test | git-pr (bỏ trống = tất cả)"
user-invocable: true
---

# Read Project Rules

Single source of truth về **cách thức và thứ tự tìm rule** trong project. Mọi skill/agent cần rule (doc-review, implementer, reviewer, designer, ...) đều nạp rule qua skill này thay vì tự mô tả cách tìm riêng — nhờ đó khi project thay đổi nơi đặt rule, chỉ cần sửa một chỗ.

## Đầu vào

`$ARGUMENTS` = `[category]` (tùy chọn, có thể nhiều category cách nhau bằng dấu cách).
Bỏ trống = tìm **tất cả** category.

## Các category rule

| Category | Tên section trong output | Keywords tìm file/section | Tiêu chí hợp lệ riêng |
|---|---|---|---|
| `coding` | Rule coding | `coding`, `code`, `convention`, `style`, `lint` | — |
| `doc-writing` | Rule viết tài liệu | `doc-writing`, `document`, `design`, `investigate`, `writing` | — |
| `doc-review` | Rule review doc | `doc-review`, `review`, `document` | Phải có **ít nhất hai phần**: **kỹ thuật** (nội dung, logic, độ chính xác) và **trình bày** (ngôn ngữ, câu cú, văn phong) |
| `test` | Rule test | `test`, `testing`, `test-spec` | — |
| `git-pr` | Rule git/PR | `git`, `commit`, `pr`, `branch` | — |

Project có thể định nghĩa thêm category khác — nếu khi tìm thấy rule không khớp category nào ở trên, đưa vào section **Rule khác** với tên gọi theo nội dung rule.

## Thứ tự tìm kiếm (áp dụng cho từng category)

Tìm theo thứ tự ưu tiên sau, **dừng lại khi tìm được rule hợp lệ**:

1. **`AGENTS.md` hoặc `CLAUDE.md`** ở root project — tìm section có heading hoặc nội dung khớp keywords của category.
2. **File rule trong `.claude/rules/` hoặc `.cursor/rules/`** — tìm file có tên chứa keywords của category.

Nguyên tắc:

- **Rule ≠ tài liệu mô tả.** Một section/file chỉ được tính là rule khi nội dung mang tính **quy định** — chỉ ra cách phải làm (convention, tiêu chí, format bắt buộc, checklist). Keyword xuất hiện trong tên sản phẩm, mô tả tính năng, hay hướng dẫn cài đặt thì không tính (ví dụ: chữ "code" trong "Claude Code", chữ "review" trong mô tả một plugin).
- Rule tìm được phải thỏa **tiêu chí hợp lệ riêng** của category (nếu có trong bảng trên). Không hợp lệ → coi như chưa tìm được, tiếp tục nguồn kế tiếp.
- Nguồn ưu tiên cao hơn thắng: nếu `CLAUDE.md` đã có rule hợp lệ cho một category thì không lấy thêm từ `.claude/rules/` cho category đó.
- **Không tự bịa rule.** Không tìm thấy → ghi nhận trung thực vào section "Không tìm thấy" của output, kèm nơi đã tìm và lý do không hợp lệ (nếu tìm thấy nhưng bị loại).
- Trích **nguyên văn** nội dung rule (hoặc đường dẫn file + các điểm chính nếu rule quá dài) — không diễn giải lại theo ý mình, vì skill gọi sẽ áp dụng đúng từng câu chữ của rule.

## Format output

Luôn trả về theo đúng cấu trúc sau (bỏ qua section của category không được yêu cầu; section không tìm thấy rule thì chuyển xuống "Không tìm thấy"):

```markdown
# Project Convention Rules

## Rule coding
**Nguồn**: <đường dẫn file> — <section nếu có>
<nội dung rule nguyên văn, hoặc đường dẫn + tóm tắt các điểm chính nếu quá dài>

## Rule viết tài liệu
**Nguồn**: ...
...

## Rule review doc
**Nguồn**: ...
...

## Rule test
**Nguồn**: ...
...

## Rule git/PR
**Nguồn**: ...
...

## Rule khác
<!-- chỉ có khi phát hiện rule ngoài các category trên -->

## Không tìm thấy
- **<category>**: đã tìm tại <danh sách nơi đã tìm> — <"không có" | "tìm thấy ở X nhưng không hợp lệ vì ...">
```

## Lưu ý cho skill/agent gọi nội bộ

- **Caller chính là `dev-team-orchestrator`**: trong pipeline, orchestrator gọi skill này **một lần** (mọi category) ở đầu, ghi kết quả vào `.dev-team-agent/project-rules.md` (root, dùng chung mọi task), rồi truyền phần rule tương ứng cho từng agent. Các agent **không tự gọi** skill này — chỉ đọc phần được chỉ định trong `project-rules.md`. Trường hợp chạy độc lập (ví dụ `/doc-review`) thì skill gọi tự nạp qua đây.
- Skill này chỉ **tìm và trả về rule**, không áp dụng rule. Việc chấm điểm, review, hay enforce là trách nhiệm của skill gọi.
- Skill gọi (hoặc orchestrator) quyết định hành vi khi category cần thiết nằm trong "Không tìm thấy":
  - **Bắt buộc** (dừng khi thiếu): `doc-writing` (investigator/designer) và `doc-review` (doc-reviewer).
  - **Fallback template** (vẫn chạy khi thiếu): `coding`, `test`, `git-pr`.
- Rule trong project (tìm thấy qua skill này) **ưu tiên hơn** rule mặc định hardcode trong các reference skill của plugin (`coding-rules`, `write-design`, `write-tests`, `create-pr`) — với category fallback, các skill đó là template khi project chưa định nghĩa; với category bắt buộc, không có template fallback.
