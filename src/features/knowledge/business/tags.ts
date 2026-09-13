import { and, eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import { knowledgeTagAliases, knowledgeTags } from '../../../backend/db/schema.js'
import {
  DEFAULT_TAG_COLOR,
  TAG_COLORS,
  type TagColor,
  type TagCreateBody,
  type TagUpdateBody,
} from '../schemas/knowledge.js'
import { sanitiseTags } from './fileDriver.js'
import { knowledgeDb, storeKeysOf, type KnowledgeStoreKeys } from './knowledgeDb.js'

/**
 * Metadata của tag (màu, mô tả) trên `dashboard.sqlite`.
 *
 * Tag lần đầu là **thực thể**: trước đây nó chỉ là facet đếm tại chỗ từ
 * front-matter, nên một tag chưa entry nào gắn thì không tồn tại — và
 * "tạo tag rồi chọn màu" không có chỗ để sống.
 *
 * 🚫 Bảng này **không** giữ quan hệ tag↔entry: gán tag vẫn nằm ở front-matter
 * của `.md`, nên bundle gửi cho agent chạy ngoài repo không đổi.
 */

export interface KnowledgeTagMeta {
  tag: string
  color: TagColor
  description: string
  scope: string
}

/** Facet đếm từ `countTags`, đã gắn metadata. `count: 0` = tag chưa entry nào gắn. */
export interface KnowledgeTagFacet {
  tag: string
  count: number
  color: TagColor
  description: string
  /** Store đang giữ metadata; `project` khi tag chưa có hàng metadata nào. */
  scope: string
}

/** Giá trị lạ trong DB (sửa tay) rơi về token mặc định, không render chip mất màu. */
function safeColor(raw: unknown): TagColor {
  return (TAG_COLORS as readonly string[]).includes(String(raw))
    ? (raw as TagColor)
    : DEFAULT_TAG_COLOR
}

/**
 * Thứ tự gộp hai store: `global` trước, `project` đè lên.
 *
 * Một tag trùng tên ở cả hai store thì lấy màu của project đang mở — đó là
 * store người dùng vừa thao tác, nên cũng là màu họ vừa chọn.
 */
function mergeOrder(keys: KnowledgeStoreKeys): string[] {
  return [...new Set([keys.byScope.global, keys.byScope.project].filter((v): v is string => !!v))]
}

function scopeOfStore(keys: KnowledgeStoreKeys, storeKey: string): string {
  return keys.byScope.project === storeKey ? 'project' : 'global'
}

/** Metadata tag của mọi store, đã gộp theo `mergeOrder`. */
export async function listTagMeta(devTeamRoot: string): Promise<KnowledgeTagMeta[]> {
  const keys = storeKeysOf(devTeamRoot)
  const order = mergeOrder(keys)
  if (!order.length) return []
  const db = await knowledgeDb()
  const rows = db.select().from(knowledgeTags).where(inArray(knowledgeTags.storeKey, order)).all()
  const byTag = new Map<string, KnowledgeTagMeta>()
  for (const storeKey of order) {
    for (const r of rows.filter((row) => row.storeKey === storeKey)) {
      byTag.set(r.tag, {
        tag: r.tag,
        color: safeColor(r.color),
        description: r.description ?? '',
        scope: scopeOfStore(keys, storeKey),
      })
    }
  }
  return [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag))
}

/**
 * Gắn `color` / `description` vào facet của `countTags`, và **thêm** tag chỉ
 * có trong DB với `count: 0` — tag rỗng là trạng thái hợp lệ mới, giấu nó đi
 * thì vừa tạo tag xong đã không thấy đâu.
 *
 * **Safe theo thiết kế**: đây là đường đọc danh sách entry (`include=tags`),
 * DB hỏng chỉ được làm mất phần màu, 🚫 không được đánh sập danh sách
 * knowledge vốn đọc từ file. Lỗi DB nổi lên ở đường đọc collection và mọi
 * đường ghi, nên người dùng vẫn nhận tín hiệu và vẫn bị khoá ghi.
 */
export async function decorateTagFacets(
  devTeamRoot: string,
  facets: { tag: string; count: number }[],
): Promise<KnowledgeTagFacet[]> {
  let meta: KnowledgeTagMeta[] = []
  try {
    meta = await listTagMeta(devTeamRoot)
  } catch {
    meta = []
  }
  const byTag = new Map(meta.map((m) => [m.tag, m]))
  const decorated: KnowledgeTagFacet[] = facets.map((f) => ({
    tag: f.tag,
    count: f.count,
    color: byTag.get(f.tag)?.color ?? DEFAULT_TAG_COLOR,
    description: byTag.get(f.tag)?.description ?? '',
    // Chưa có hàng metadata → `project`: đó là store mà dialog sẽ ghi vào, nên
    // trả sẵn đúng giá trị đó thay vì để client tự đoán.
    scope: byTag.get(f.tag)?.scope ?? 'project',
  }))
  const seen = new Set(facets.map((f) => f.tag))
  for (const m of meta) {
    if (!seen.has(m.tag)) {
      decorated.push({
        tag: m.tag,
        count: 0,
        color: m.color,
        description: m.description,
        scope: m.scope,
      })
    }
  }
  return decorated.sort((a, b) => a.tag.localeCompare(b.tag))
}

export async function createTag(devTeamRoot: string, body: z.infer<typeof TagCreateBody>) {
  const keys = storeKeysOf(devTeamRoot)
  const storeKey = keys.byScope[body.scope]
  if (!storeKey) return { status: 400 as const, error: `invalid scope: ${body.scope}` }
  // Cùng luật với tag trong front-matter — tag DB không khớp thì không bao giờ
  // gắn được vào entry nào.
  const tag = sanitiseTags([body.tag])[0]
  if (!tag) return { status: 400 as const, error: 'invalid tag' }

  const db = await knowledgeDb()
  const exists = db
    .select()
    .from(knowledgeTags)
    .where(and(eq(knowledgeTags.storeKey, storeKey), eq(knowledgeTags.tag, tag)))
    .get()
  if (exists) return { status: 400 as const, error: `tag already exists: ${tag}` }

  const now = new Date().toISOString()
  db.insert(knowledgeTags)
    .values({
      storeKey,
      tag,
      color: body.color,
      description: body.description ?? '',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return { tag: { tag, color: body.color, description: body.description ?? '', scope: body.scope } }
}

/**
 * Sửa màu / mô tả. Tag chưa có hàng metadata thì **tạo** — phần lớn tag sinh ra
 * từ front-matter chứ không qua dialog, nên "chọn màu cho tag đang có" phải
 * chạy được mà không bắt người dùng tạo lại tag.
 */
export async function updateTag(
  devTeamRoot: string,
  rawTag: string,
  body: z.infer<typeof TagUpdateBody>,
) {
  const keys = storeKeysOf(devTeamRoot)
  const storeKey = keys.byScope[body.scope]
  if (!storeKey) return { status: 400 as const, error: `invalid scope: ${body.scope}` }
  const tag = sanitiseTags([rawTag])[0]
  if (!tag) return { status: 400 as const, error: 'invalid tag' }

  const db = await knowledgeDb()
  const now = new Date().toISOString()
  const prev = db
    .select()
    .from(knowledgeTags)
    .where(and(eq(knowledgeTags.storeKey, storeKey), eq(knowledgeTags.tag, tag)))
    .get()
  const next = {
    color: body.color ?? safeColor(prev?.color),
    description: body.description ?? prev?.description ?? '',
  }
  if (prev) {
    db.update(knowledgeTags)
      .set({ ...next, updatedAt: now })
      .where(and(eq(knowledgeTags.storeKey, storeKey), eq(knowledgeTags.tag, tag)))
      .run()
  } else {
    db.insert(knowledgeTags)
      .values({ storeKey, tag, ...next, createdAt: now, updatedAt: now })
      .run()
  }
  return { tag: { tag, ...next, scope: body.scope } }
}

// ── alias ──────────────────────────────────────────────────────────────────

/**
 * Alias `from → to` của mọi store.
 *
 * **Safe**: đây là đường **đọc entry** (`?tags=` đi qua `resolveTagAliases`),
 * DB hỏng chỉ được làm mất bước giải alias chứ 🚫 không đánh sập danh sách.
 */
export async function readTagAliasesSafe(devTeamRoot: string): Promise<Record<string, string>> {
  try {
    const keys = storeKeysOf(devTeamRoot)
    const order = mergeOrder(keys)
    if (!order.length) return {}
    const db = await knowledgeDb()
    const rows = db
      .select()
      .from(knowledgeTagAliases)
      .where(inArray(knowledgeTagAliases.storeKey, order))
      .all()
    return Object.fromEntries(rows.map((r) => [r.fromTag, r.toTag]))
  } catch {
    return {}
  }
}
