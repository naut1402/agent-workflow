import { z } from 'zod'

/**
 * Zod là nguồn chân lý cho bề mặt HTTP của knowledge — controller parse mọi
 * query/body qua đây, driver không tin request nữa.
 *
 * `KNOWLEDGE_SCOPES` là nguồn duy nhất của danh sách scope: `fileDriver` tra
 * bảng `scope → base` theo đúng thứ tự này, nên thêm scope là sửa một chỗ.
 * Scope nằm **trong** id (`<scope>/<slug>`) nên chỉ được *thêm* giá trị mới,
 * đổi giá trị cũ là đổi id của mọi entry đang tồn tại.
 */
export const KNOWLEDGE_SCOPES = ['project', 'system', 'global'] as const

export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number]

/** Khớp `taskCreate.ts` — cùng trần số lượng knowledge cho một lượt. */
export const MAX_BUNDLE_IDS = 50
export const MAX_BUNDLE_BYTES = 1024 * 1024

export const KnowledgeListQuery = z.object({
  id: z.string().min(1).max(200).optional(),
  scope: z.enum([...KNOWLEDGE_SCOPES, 'all']).optional(),
  /** CSV — tách ở controller. */
  tags: z.string().max(400).optional(),
  collection: z.string().max(80).optional(),
  q: z.string().max(200).optional(),
  /** Opt-in trả kèm facet tag để panel không phải gọi thêm `/tags`. */
  include: z.enum(['tags']).optional(),
})

export const KnowledgeWriteBody = z.object({
  id: z.string().min(1).max(200).optional(),
  title: z.string().max(200).optional(),
  slug: z.string().max(200).optional(),
  scope: z.enum(KNOWLEDGE_SCOPES).default('project'),
  /** Driver tự `sanitiseTags`, nên nhận cả mảng lẫn chuỗi CSV. */
  tags: z.union([z.array(z.string()), z.string()]).optional(),
  content: z.string().max(512 * 1024).optional(),
})

/** Field `scope` của form upload — validate riêng vì FormData trả `string | File`. */
export const KnowledgeUploadScope = z.enum(KNOWLEDGE_SCOPES)

export const BundleQuery = z.object({ ids: z.string().min(1).max(4000) })

export const CollectionBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  /** Quyết định `collections.yaml` nào chứa nó, không phải scope của entry. */
  scope: z.enum(['project', 'global']).default('project'),
  tags: z.array(z.string()).max(16).optional(),
  entryIds: z.array(z.string().min(1)).max(200).optional(),
})

/** `to` bỏ trống = xoá tag khỏi mọi entry (không tạo alias). */
export const TagRenameBody = z.object({ from: z.string().min(1), to: z.string().optional() })
