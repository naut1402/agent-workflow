import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle schema — kept SQLite/Postgres-portable (no SQLite-only feature) so a
 * later switch to Postgres only swaps the driver.
 *
 * `payload` holds the full JSON-serialised `LogEntry` (schema.ts in core/log);
 * per-type fields stay in there so they never force a wide, mostly-NULL table.
 * `type`/`ts`/`project_id` are lifted out and indexed because `readLogs()`
 * filters and sorts on them; `level`/`trace_id` are spare columns for filters
 * that do not exist yet, so nothing reads them.
 */
export const logEntries = sqliteTable(
  'log_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    ts: integer('ts').notNull(),
    level: text('level').notNull(),
    traceId: text('trace_id').notNull().default(''),
    projectId: text('project_id'),
    payload: text('payload').notNull(),
  },
  (table) => [
    index('idx_log_entries_type_ts').on(table.type, table.ts),
    index('idx_log_entries_project_ts').on(table.projectId, table.ts),
  ],
)

/**
 * Collection + tag của knowledge — rời sidecar `collections.yaml` về đây để
 * một collection/tag rỗng cũng tồn tại được (điều kiện để "tạo tag + chọn
 * màu" có nghĩa), và để một đường ghi duy nhất.
 *
 * `store_key` là đường dẫn tuyệt đối của store base (`<root>/knowledge`
 * cho project+system, `globalKnowledgeRoot()` cho global) — đúng thứ đang mang
 * nghĩa phân vùng hôm nay: `collections.yaml` nằm ở đâu thì hàng thuộc về đó.
 * Không dùng `project_id` như `log_entries`: nó `null` khi request không
 * truyền `?project=`, nên cùng một thư mục sinh ra hai khoá khác nhau — và
 * `UNIQUE` với cột NULL trong SQLite không ràng buộc được gì, khiến lệnh
 * migrate nhân đôi dữ liệu mỗi lần chạy lại.
 *
 * `tags` / `entry_ids` là cột TEXT chứa JSON, đúng tiền lệ `log_entries.payload`:
 * thành viên collection luôn resolve trong bộ nhớ lúc đọc
 * (`resolveCollectionEntries`), repo không có truy vấn "collection nào chứa
 * entry X" nên chuẩn hoá thành bảng liên kết chỉ thêm join mà không thêm gì.
 */
export const knowledgeCollections = sqliteTable(
  'knowledge_collections',
  {
    rowId: integer('row_id').primaryKey({ autoIncrement: true }),
    storeKey: text('store_key').notNull(),
    /** `'project' | 'global'` — store nào chứa nó, không phải scope của entry. */
    scope: text('scope').notNull(),
    /** Id ổn định, giữ nguyên qua migrate từ YAML. */
    collectionId: text('collection_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** JSON `string[]`. */
    tags: text('tags').notNull().default('[]'),
    /** JSON `string[]`. */
    entryIds: text('entry_ids').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('uq_knowledge_collections').on(table.storeKey, table.collectionId)],
)

/**
 * Metadata của tag (màu, mô tả). Gán tag cho entry vẫn ở front-matter —
 * bảng này cố ý không có cột nào trỏ tới entry, nên bundle gửi cho agent chạy
 * ngoài repo không đổi một byte.
 */
export const knowledgeTags = sqliteTable(
  'knowledge_tags',
  {
    rowId: integer('row_id').primaryKey({ autoIncrement: true }),
    storeKey: text('store_key').notNull(),
    /** Khớp `^[a-z0-9][a-z0-9_-]{0,31}$` của `sanitiseTags`. */
    tag: text('tag').notNull(),
    /** Tên token trong `TAG_COLORS`, không phải hex. */
    color: text('color').notNull().default('slate'),
    description: text('description').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('uq_knowledge_tags').on(table.storeKey, table.tag)],
)

/** Alias `from → to` sau khi đổi tên tag — giữ `?tags=` và bookmark cũ còn sống. */
export const knowledgeTagAliases = sqliteTable(
  'knowledge_tag_aliases',
  {
    storeKey: text('store_key').notNull(),
    fromTag: text('from_tag').notNull(),
    toTag: text('to_tag').notNull(),
  },
  (table) => [primaryKey({ columns: [table.storeKey, table.fromTag] })],
)
