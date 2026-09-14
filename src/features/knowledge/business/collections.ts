import { and, eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import { knowledgeCollections, knowledgeTagAliases } from '../../../backend/db/schema.js'
import { slugify } from '../../../shared/lib/stringUtils.js'
import type { CollectionBody, TagRenameBody } from '../schemas/knowledge.js'
import { createFileDriver, sanitiseTags } from './fileDriver.js'
import { knowledgeDb, storeKeysOf, type KnowledgeStoreKeys } from './knowledgeDb.js'
import { moveTagMetaInTx, readTagMetaRows } from './tags.js'

/**
 * Collection = nhóm knowledge, lưu ở bảng `knowledge_collections` của
 * `dashboard.sqlite` (trước đây là sidecar `collections.yaml` cạnh cây entry).
 *
 * Vì sao không phải thư mục con hay front-matter:
 * - Thư mục con sẽ đổi id của mọi entry (`slug` thành `collection/slug`) và
 *   phá mọi `knowledge_inputs` đang trỏ tới.
 * - Front-matter thì collection rỗng không tồn tại được, và liệt kê
 *   collection phải đọc toàn bộ file `.md`.
 *
 * Thành viên = hợp của `entry_ids` và `tags`, resolve lúc đọc — nên entry
 * bị xoá tay ngoài dashboard chỉ đơn giản biến mất khỏi nhóm, không cần job dọn.
 * Đó cũng là lý do `tags`/`entry_ids` là cột JSON chứ không phải bảng liên kết:
 * repo không có truy vấn "collection nào chứa entry X".
 */

export interface KnowledgeCollection {
  id: string
  name: string
  description?: string
  tags?: string[]
  entry_ids?: string[]
  created_at?: string
  updated_at?: string
  /** Store chứa nó — phái sinh từ `store_key`, không phải cột riêng. */
  scope?: string
  /** Số entry resolve được — phái sinh, không persist. */
  entryCount?: number
}

type CollectionRow = typeof knowledgeCollections.$inferSelect

/** Cột JSON người dùng sửa tay được → parse phòng thủ, hỏng thì coi là rỗng. */
function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function toCollection(row: CollectionRow): KnowledgeCollection {
  return {
    id: row.collectionId,
    name: row.name,
    description: row.description,
    tags: parseList(row.tags),
    entry_ids: parseList(row.entryIds),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    scope: row.scope,
  }
}

/**
 * Thành viên của collection = `entry_ids` ∪ (entry mang đủ mọi tag của nhóm).
 * Id treo không khớp entry nào nên tự rơi ra — đó là cách nhóm tự dọn.
 */
export function resolveCollectionEntries<T extends { id: string; tags: string[] }>(
  collection: KnowledgeCollection,
  entries: T[],
): T[] {
  const want = sanitiseTags(collection.tags)
  const byId = new Set(collection.entry_ids ?? [])
  return entries.filter((e) => byId.has(e.id) || (want.length > 0 && want.every((t) => e.tags.includes(t))))
}

/** Mọi truy vấn lọc theo `store_key`: một bảng dùng chung cho mọi project. */
async function rowsOf(keys: KnowledgeStoreKeys): Promise<CollectionRow[]> {
  if (!keys.all.length) return []
  const db = await knowledgeDb()
  return db
    .select()
    .from(knowledgeCollections)
    .where(inArray(knowledgeCollections.storeKey, keys.all))
    .all()
}

/** Lọc ở DB chứ không ở tầng app — hàm này nằm trên đường đọc danh sách entry. */
async function findRow(keys: KnowledgeStoreKeys, id: string): Promise<CollectionRow | null> {
  if (!keys.all.length) return null
  const db = await knowledgeDb()
  return (
    db
      .select()
      .from(knowledgeCollections)
      .where(
        and(
          inArray(knowledgeCollections.storeKey, keys.all),
          eq(knowledgeCollections.collectionId, id),
        ),
      )
      .get() ?? null
  )
}

/**
 * Bản cho đường đọc entry (lọc `list({ collection })`): DB hỏng chỉ làm mất
 * phần nhóm, không được đánh sập danh sách knowledge vốn đọc từ file.
 */
export async function findCollectionSafe(
  devTeamRoot: string,
  id: string,
): Promise<KnowledgeCollection | null> {
  try {
    const row = await findRow(storeKeysOf(devTeamRoot), id)
    return row ? toCollection(row) : null
  } catch {
    return null
  }
}

export async function listCollections(devTeamRoot: string) {
  const keys = storeKeysOf(devTeamRoot)
  const entries = await createFileDriver(devTeamRoot).list({ scope: 'all' })
  const rows = await rowsOf(keys)
  const collections = rows
    .map((row) => {
      const c = toCollection(row)
      return { ...c, entryCount: resolveCollectionEntries(c, entries as any).length }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const db = await knowledgeDb()
  const aliasRows = keys.all.length
    ? db
        .select()
        .from(knowledgeTagAliases)
        .where(inArray(knowledgeTagAliases.storeKey, keys.all))
        .all()
    : []
  return {
    collections,
    tagAliases: Object.fromEntries(aliasRows.map((r) => [r.fromTag, r.toTag])),
  }
}

export async function createCollection(
  devTeamRoot: string,
  body: z.infer<typeof CollectionBody>,
) {
  const keys = storeKeysOf(devTeamRoot)
  const storeKey = keys.byScope[body.scope]
  if (!storeKey) return { status: 400 as const, error: `invalid scope: ${body.scope}` }
  // `slugify` chứ không `sanitiseSlug`: bản sau băm nát tiếng Việt
  // (`nhóm-kiến-trúc` → `nh-m-ki-n-tr-c`), id nhóm phải còn đọc được.
  const id = slugify(body.name, { maxLength: 80, fallback: '' })
  if (!id) return { status: 400 as const, error: 'invalid collection name' }
  if (await findRow(keys, id)) return { status: 400 as const, error: `collection already exists: ${id}` }

  const now = new Date().toISOString()
  const tags = sanitiseTags(body.tags)
  const entryIds = body.entryIds ?? []
  const db = await knowledgeDb()
  db.insert(knowledgeCollections)
    .values({
      storeKey,
      scope: body.scope,
      collectionId: id,
      name: body.name,
      description: body.description ?? '',
      tags: JSON.stringify(tags),
      entryIds: JSON.stringify(entryIds),
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return {
    collection: {
      id,
      name: body.name,
      description: body.description ?? '',
      tags,
      entry_ids: entryIds,
      created_at: now,
      updated_at: now,
      scope: body.scope,
    } satisfies KnowledgeCollection,
  }
}

/** `id` cố định — đổi id là đổi con trỏ của mọi nơi đang tham chiếu nhóm. */
export async function updateCollection(
  devTeamRoot: string,
  id: string,
  body: z.infer<typeof CollectionBody>,
) {
  const keys = storeKeysOf(devTeamRoot)
  const row = await findRow(keys, id)
  if (!row) return { status: 404 as const, error: `unknown collection: ${id}` }

  // Đổi scope là đổi store, tức đổi con trỏ của mọi nơi tham chiếu nhóm →
  // từ chối thẳng thay vì nhận 200 rồi im lặng không đổi gì.
  if (body.scope && body.scope !== row.scope) {
    return {
      status: 400 as const,
      error: `collection ${id} thuộc scope ${row.scope}, không đổi được sang ${body.scope}`,
    }
  }
  const prev = toCollection(row)
  const next: KnowledgeCollection = {
    ...prev,
    name: body.name,
    description: body.description === undefined ? prev.description : body.description,
    tags: sanitiseTags(body.tags),
    entry_ids: body.entryIds ?? prev.entry_ids ?? [],
    updated_at: new Date().toISOString(),
  }
  const db = await knowledgeDb()
  db.update(knowledgeCollections)
    .set({
      name: next.name,
      description: next.description ?? '',
      tags: JSON.stringify(next.tags ?? []),
      entryIds: JSON.stringify(next.entry_ids ?? []),
      updatedAt: next.updated_at as string,
    })
    .where(eq(knowledgeCollections.rowId, row.rowId))
    .run()
  return { collection: next }
}

/** Chỉ gỡ nhóm — không xoá entry nào trên đĩa. */
export async function deleteCollection(devTeamRoot: string, id: string) {
  const keys = storeKeysOf(devTeamRoot)
  const row = await findRow(keys, id)
  if (!row) return { status: 404 as const, error: `unknown collection: ${id}` }
  const db = await knowledgeDb()
  db.delete(knowledgeCollections).where(eq(knowledgeCollections.rowId, row.rowId)).run()
  return { deleted: true, id }
}

/**
 * Đổi tên tag trên mọi entry chứa nó, và ghi alias `from → to`.
 *
 * Merge không cần nhánh riêng: entry đã mang `to` thì `Set` gộp lại, nên
 * "rename vào tag đã tồn tại" chính là merge.
 *
 * `to` bỏ trống = xoá tag khỏi mọi entry, không tạo alias.
 *
 * Lỗi giữa chừng thì dừng tại đó và trả phần đã xong — chạy lại là an toàn vì
 * entry đã đổi không còn `from` nên lần sau bị bỏ qua.
 *
 * Phần DB — alias, metadata tag, tag của collection — đi cùng một
 * transaction sau khi rewrite file xong. Không dựng được transaction xuyên
 * file + DB, nên thứ tự là: file trước (thứ có thể chạy lại an toàn), DB sau
 * (thứ nguyên tử). Hỏng ở bước DB thì entry đã mang tên mới còn alias chưa có
 * — chạy lại lệnh đổi tên là hết, không entry nào mất.
 */
export async function renameTag(devTeamRoot: string, { from, to }: z.infer<typeof TagRenameBody>) {
  const src = sanitiseTags([from])[0]
  const dst = to ? sanitiseTags([to])[0] : null
  if (!src) return { status: 400 as const, error: 'invalid tag: from' }
  if (to && !dst) return { status: 400 as const, error: 'invalid tag: to' }
  if (src === dst) return { renamed: 0, entries: [], alias: null }

  const keys = storeKeysOf(devTeamRoot)
  const driver = createFileDriver(devTeamRoot)
  const matches = await driver.list({ scope: 'all', tags: [src] })

  const touched: string[] = []
  for (const meta of matches) {
    try {
      const entry = await driver.read(meta.id)
      const next = [...new Set(entry.tags.map((t) => (t === src ? dst : t)).filter(Boolean))]
      await driver.write({
        id: entry.id,
        title: entry.title,
        slug: entry.slug,
        scope: entry.scope,
        tags: next,
        content: entry.content,
      })
      touched.push(entry.id)
    } catch (e) {
      // Dừng tại entry hỏng và trả kèm phần đã xong: người dùng phải biết kho
      // đang ở trạng thái nửa chừng nào mới quyết được chạy lại hay khôi phục.
      return {
        status: 500 as const,
        error: `đổi tag thất bại tại ${meta.id}: ${(e as Error)?.message ?? e}`,
        renamed: touched.length,
        entries: touched,
        failedId: meta.id,
      }
    }
  }

  // Phạm vi bên DB là mọi store, không phải store có entry bị chạm.
  //
  // `driver.list({ scope: 'all' })` ở trên vốn đã quét mọi scope; và từ khi tag
  // là thực thể, "tag 0 entry" là trạng thái hợp lệ thường gặp — bám theo
  // `touched` thì đúng lúc alias + metadata là thứ duy nhất cần sửa lại là lúc
  // không có gì được ghi, trong khi hàm vẫn trả `alias` như đã ghi xong.
  if (keys.all.length) {
    const db = await knowledgeDb()
    const rows = await rowsOf(keys)
    const tagRows = await readTagMetaRows(devTeamRoot)
    const now = new Date().toISOString()
    // Một transaction cho cả ba bảng: nửa vời ở đây nghĩa là alias trỏ tới tag
    // mà không nhóm nào còn mang, hoặc metadata mồ côi mang tên đã biến mất.
    db.transaction((tx) => {
      for (const storeKey of keys.all) {
        if (dst) {
          tx.insert(knowledgeTagAliases)
            .values({ storeKey, fromTag: src, toTag: dst })
            .onConflictDoUpdate({
              target: [knowledgeTagAliases.storeKey, knowledgeTagAliases.fromTag],
              set: { toTag: dst },
            })
            .run()
        }
        moveTagMetaInTx(tx, { storeKey, from: src, to: dst, rows: tagRows, now })
        for (const row of rows.filter((r) => r.storeKey === storeKey)) {
          const tags = parseList(row.tags)
          if (!tags.includes(src)) continue
          const nextTags = [...new Set(tags.map((t) => (t === src ? dst : t)).filter(Boolean))]
          tx.update(knowledgeCollections)
            .set({ tags: JSON.stringify(nextTags), updatedAt: now })
            .where(eq(knowledgeCollections.rowId, row.rowId))
            .run()
        }
      }
    })
  }

  return { renamed: touched.length, entries: touched, alias: dst ? [src, dst] : null }
}
