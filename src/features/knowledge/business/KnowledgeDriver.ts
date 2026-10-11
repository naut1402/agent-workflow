/**
 * Hợp đồng lưu trữ knowledge — thao tác thô trên entry, không biết lọc, alias,
 * facet hay collection (những thứ đó ở `knowledgeEntries.ts`, `collections.ts`,
 * `tags.ts` và chỉ gọi qua interface này).
 *
 * Đúng một chỗ biết hiện thực cụ thể: `knowledgeDriverRegistry.ts`.
 */

/** Một entry đầy đủ, như driver đọc ra. */
export interface KnowledgeEntry {
  /** `<scope>/<slug>` — scope nằm trong id nên mọi driver phải giữ đúng dạng này. */
  id: string
  slug: string
  scope: string
  title: string
  tags: string[]
  content: string
  updated_at: string | null
  /**
   * Chỗ đọc được entry ngoài API, nếu driver có. Consumer có quyền đọc đĩa
   * (khung chat) chèn nó vào prompt; consumer không có thì dùng `content`.
   */
  path?: string
}

/** Entry trong danh sách — không kèm `content` / `path`. */
export type KnowledgeEntryMeta = Omit<KnowledgeEntry, 'content' | 'path'>

export interface KnowledgeWriteInput {
  /** Có `id` = sửa entry đó; không có = tạo mới, slug do driver nội suy. */
  id?: string
  title?: string
  slug?: string
  scope?: string
  /** Mảng hoặc chuỗi CSV — driver tự `sanitiseTags`. */
  tags?: unknown
  content?: string
}

export interface KnowledgeUploadInput {
  filename: string
  content: string
  scope?: string
  tags?: string[]
  title?: string
}

export interface KnowledgeDriver {
  /** Scope đang dùng được, theo thứ tự `KNOWLEDGE_SCOPES`. */
  scopes(): readonly string[]
  /** Mọi entry trong các scope cho trước (mặc định: `scopes()`), chưa lọc gì. */
  listEntries(scopes?: readonly string[]): Promise<KnowledgeEntry[]>
  read(id: string): Promise<KnowledgeEntry>
  write(input: KnowledgeWriteInput): Promise<KnowledgeEntry>
  upload(input: KnowledgeUploadInput): Promise<KnowledgeEntry>
  delete(id: string): Promise<{ deleted: true; id: string }>
}

/**
 * Luật tag mọi driver phải theo — và cũng là luật của tag trong DB
 * (`tags.ts`, `collections.ts`): tag không khớp luật này thì không bao giờ gắn
 * được vào entry nào.
 */
export function sanitiseTags(tags: unknown): string[] {
  if (!tags) return []
  const list = Array.isArray(tags) ? tags : String(tags).split(/[,;\s]+/)
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter((t) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(t)))]
}
