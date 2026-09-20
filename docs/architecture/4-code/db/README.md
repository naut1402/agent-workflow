# Tầng DB `src/backend/db/`

← [`../README.md`](../README.md) (Cấp 4 · Code)

Một file SQLite dùng chung cho mọi subsystem cần lưu trữ có cấu trúc thay vì file-based — hiện gồm log backend `sqlite` (opt-in) và collection/tag của knowledge (luôn bật). Đọc trước khi bật `logging.driver: sqlite` hoặc thêm bảng mới vào file này.

| Chủ đề | Chi tiết |
|---|---|
| **Vị trí file** | `registryHome()/dashboard.sqlite` — nằm **ngoài** cây repo, cùng chỗ với `projects.json`. Không có file DB nào sinh trong repo, `.gitignore` không phải đụng. |
| **`client.ts`** | Giữ connection cache dùng chung (`getDb()`), bật `WAL` + `foreign_keys`, chạy migration Drizzle khi mở lần đầu (idempotent). Migration chạy cho **mọi** subsystem dùng chung file — một migration hỏng kéo cả đường log xuống theo. |
| **`schema.ts` + `migrations/`** | Schema Drizzle giữ portable (không dùng feature riêng của SQLite) để sau này đổi sang Postgres không phải viết lại. Bảng: `log_entries`, `knowledge_collections`, `knowledge_tags`, `knowledge_tag_aliases`. |
| **`migrateLogs.ts`** + `scripts/migrate-logs-to-sqlite.ts` | Nạp JSONL cũ vào bảng `log_entries`, một transaction cho mỗi file nguồn. Chỉ đọc, **không xoá** file nguồn; **không idempotent** (chạy lại sinh bản ghi trùng). |
| **`migrateKnowledge.ts`** + `scripts/migrate-knowledge-to-sqlite.ts` | Nạp `collections.yaml` của mọi project đã đăng ký + store global vào `knowledge_collections` / `knowledge_tag_aliases`. Chỉ đọc, **không xoá** file nguồn, và **idempotent** (`UNIQUE(store_key, collection_id)` + `onConflictDoNothing`). ⚠️ Phải chạy tay một lần trên mỗi máy đang chạy dashboard sau khi nâng cấp, nếu không collection cũ không hiện lại. |
| **Lỗi mở DB** | Nổi lên ở knowledge, nuốt ở log. Log giữ bất biến *append không bao giờ throw*; knowledge thì không — `KnowledgeDbError` → 500 tường minh, vì hiện thành "chưa có nhóm nào" sẽ khiến người dùng tạo mới đè lên dữ liệu cũ. |
| **Giới hạn đã biết** | `logging.driver = 'sqlite'` làm mode Thống kê rỗng. `readUsageEntries()` (`src/features/statistics/business/`) đọc `usage.jsonl` vô điều kiện, không hỏi `activeLogDriverKind()`, nên khi driver là `sqlite` thì entry `usage` chỉ vào `log_entries` và `GET /api/statistics/usage` trả 0 mà không báo lỗi. Chỉ bật `sqlite` để thử PoC, đừng bật khi cần số liệu usage. |
| **Backend không dùng được** | `getDb()` in `[db] sqlite unavailable` ra stderr lần đầu mở thất bại (vd chạy dưới Node, không có `bun:sqlite`). Hai consumer xử lý khác nhau: **đường log** nuốt lỗi để giữ bất biến *append không bao giờ throw* (log rỗng trông y hệt "chưa có log" nếu không để ý dòng cảnh báo); **knowledge** thì ném `KnowledgeDbError` → 500. |
