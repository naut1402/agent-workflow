import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Log entries. `payload` holds the full JSON-serialised `LogEntry`; `type` / `ts` /
 * `project_id` are lifted out and indexed for `readLogs()`.
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
 * Collection của knowledge, phân vùng theo `store_key` — đường dẫn tuyệt đối của store base.
 * xem docs/architecture/code/backend.md §1
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

/** Metadata của tag (màu, mô tả); gán tag cho entry vẫn ở front-matter, bảng không trỏ tới entry. */
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
