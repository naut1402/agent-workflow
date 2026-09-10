import type { z } from 'zod'
import { joinPath, readTextFile, writeTextFileAtomic } from '../../../core/lib/fileHelper.js'
import { loadYaml, dumpYaml } from '../../../core/lib/yamlLib.js'
import type { CollectionBody, TagRenameBody } from '../schemas/knowledge.js'
import { createFileDriver, ensureDirs, sanitiseSlug, sanitiseTags, type KnowledgeBases } from './fileDriver.js'

/**
 * Collection = nhóm knowledge, lưu ở **sidecar** `collections.yaml` cạnh cây
 * entry (một bản mỗi store base: project và global).
 *
 * Vì sao sidecar chứ không phải front-matter hay thư mục con:
 * - Thư mục con sẽ đổi id của mọi entry (`slug` thành `collection/slug`) và
 *   phá mọi `knowledge_inputs` đang trỏ tới.
 * - Front-matter thì collection **rỗng** không tồn tại được, và liệt kê
 *   collection phải đọc toàn bộ file `.md`.
 *
 * Thành viên = **hợp** của `entry_ids` và `tags`, resolve lúc đọc — nên entry
 * bị xoá tay ngoài dashboard chỉ đơn giản biến mất khỏi nhóm, không cần job dọn.
 */

const COLLECTIONS_FILE = 'collections.yaml'

export interface KnowledgeCollection {
  id: string
  name: string
  description?: string
  tags?: string[]
  entry_ids?: string[]
  created_at?: string
  updated_at?: string
  /** Store chứa nó — phái sinh từ file, không persist. */
  scope?: string
  /** Số entry resolve được — phái sinh, không persist. */
  entryCount?: number
}

export interface CollectionsDoc {
  version: number
  collections: KnowledgeCollection[]
  tag_aliases: Record<string, string>
}

/** Store nào có `collections.yaml` riêng — `system` dùng chung file với `project`. */
const COLLECTION_SCOPES = ['project', 'global'] as const

function emptyDoc(): CollectionsDoc {
  return { version: 1, collections: [], tag_aliases: {} }
}

/** Thiếu file (hoặc file hỏng) → doc rỗng, không phải lỗi: sidecar là tuỳ chọn. */
export async function readCollectionsFile(base: string): Promise<CollectionsDoc> {
  try {
    const doc: any = loadYaml(await readTextFile(joinPath(base, COLLECTIONS_FILE))) || {}
    return {
      version: Number(doc.version) || 1,
      collections: Array.isArray(doc.collections) ? doc.collections : [],
      tag_aliases: doc.tag_aliases && typeof doc.tag_aliases === 'object' ? doc.tag_aliases : {},
    }
  } catch {
    return emptyDoc()
  }
}

/** `collections.yaml` là registry đúng nghĩa → ghi atomic (AGENTS.md §4). */
export async function writeCollectionsFile(base: string, doc: CollectionsDoc): Promise<void> {
  const body = dumpYaml({
    version: doc.version || 1,
    collections: doc.collections.map(({ scope: _s, entryCount: _n, ...c }) => c),
    tag_aliases: doc.tag_aliases || {},
  })
  await writeTextFileAtomic(joinPath(base, COLLECTIONS_FILE), body)
}

function storesOf(bases: KnowledgeBases): Array<{ scope: string; base: string }> {
  return COLLECTION_SCOPES.filter((s) => bases[s]).map((s) => ({ scope: s, base: bases[s] as string }))
}

/**
 * Thành viên của collection = `entry_ids` ∪ (entry mang **đủ** mọi tag của nhóm).
 * Id treo không khớp entry nào nên tự rơi ra — đó là cách sidecar tự dọn.
 */
export function resolveCollectionEntries<T extends { id: string; tags: string[] }>(
  collection: KnowledgeCollection,
  entries: T[],
): T[] {
  const want = sanitiseTags(collection.tags)
  const byId = new Set(collection.entry_ids ?? [])
  return entries.filter((e) => byId.has(e.id) || (want.length > 0 && want.every((t) => e.tags.includes(t))))
}

async function findStoreOf(bases: KnowledgeBases, id: string) {
  for (const store of storesOf(bases)) {
    const doc = await readCollectionsFile(store.base)
    const index = doc.collections.findIndex((c) => c.id === id)
    if (index >= 0) return { ...store, doc, index }
  }
  return null
}

export async function listCollections(devTeamRoot: string) {
  const bases = await ensureDirs(devTeamRoot)
  const entries = await createFileDriver(devTeamRoot).list({ scope: 'all' })
  const collections: KnowledgeCollection[] = []
  let tagAliases: Record<string, string> = {}
  for (const store of storesOf(bases)) {
    const doc = await readCollectionsFile(store.base)
    tagAliases = { ...tagAliases, ...doc.tag_aliases }
    for (const c of doc.collections) {
      collections.push({
        ...c,
        scope: store.scope,
        entryCount: resolveCollectionEntries(c, entries as any).length,
      })
    }
  }
  collections.sort((a, b) => a.name.localeCompare(b.name))
  return { collections, tagAliases }
}

export async function createCollection(
  devTeamRoot: string,
  body: z.infer<typeof CollectionBody>,
) {
  const bases = await ensureDirs(devTeamRoot)
  const base = bases[body.scope]
  if (!base) return { status: 400, error: `invalid scope: ${body.scope}` }
  const id = sanitiseSlug(body.name)
  if (!id) return { status: 400, error: 'invalid collection name' }
  if (await findStoreOf(bases, id)) return { status: 400, error: `collection already exists: ${id}` }

  const now = new Date().toISOString()
  const collection: KnowledgeCollection = {
    id,
    name: body.name,
    ...(body.description ? { description: body.description } : {}),
    tags: sanitiseTags(body.tags),
    entry_ids: body.entryIds ?? [],
    created_at: now,
    updated_at: now,
  }
  const doc = await readCollectionsFile(base)
  doc.collections.push(collection)
  await writeCollectionsFile(base, doc)
  return { collection: { ...collection, scope: body.scope } }
}

/** `id` cố định — đổi id là đổi con trỏ của mọi nơi đang tham chiếu nhóm. */
export async function updateCollection(
  devTeamRoot: string,
  id: string,
  body: z.infer<typeof CollectionBody>,
) {
  const bases = await ensureDirs(devTeamRoot)
  const found = await findStoreOf(bases, id)
  if (!found) return { status: 404, error: `unknown collection: ${id}` }

  const prev = found.doc.collections[found.index]
  const next: KnowledgeCollection = {
    ...prev,
    name: body.name,
    ...(body.description === undefined ? {} : { description: body.description }),
    tags: sanitiseTags(body.tags),
    entry_ids: body.entryIds ?? prev.entry_ids ?? [],
    updated_at: new Date().toISOString(),
  }
  found.doc.collections[found.index] = next
  await writeCollectionsFile(found.base, found.doc)
  return { collection: { ...next, scope: found.scope } }
}

/** Chỉ gỡ nhóm khỏi sidecar — **không** xoá entry nào trên đĩa. */
export async function deleteCollection(devTeamRoot: string, id: string) {
  const bases = await ensureDirs(devTeamRoot)
  const found = await findStoreOf(bases, id)
  if (!found) return { status: 404, error: `unknown collection: ${id}` }
  found.doc.collections.splice(found.index, 1)
  await writeCollectionsFile(found.base, found.doc)
  return { deleted: true, id }
}

/**
 * Đổi tên tag trên **mọi** entry chứa nó, và ghi alias `from → to`.
 *
 * Merge không cần nhánh riêng: entry đã mang `to` thì `Set` gộp lại, nên
 * "rename vào tag đã tồn tại" chính là merge.
 *
 * `to` bỏ trống = **xoá** tag khỏi mọi entry, không tạo alias.
 *
 * Lỗi giữa chừng thì dừng tại đó và trả phần đã xong — chạy lại là an toàn vì
 * entry đã đổi không còn `from` nên lần sau bị bỏ qua.
 */
export async function renameTag(devTeamRoot: string, { from, to }: z.infer<typeof TagRenameBody>) {
  const src = sanitiseTags([from])[0]
  const dst = to ? sanitiseTags([to])[0] : null
  if (!src) return { status: 400, error: 'invalid tag: from' }
  if (to && !dst) return { status: 400, error: 'invalid tag: to' }
  if (src === dst) return { renamed: 0, entries: [], alias: null }

  const bases = await ensureDirs(devTeamRoot)
  const driver = createFileDriver(devTeamRoot)
  const matches = await driver.list({ scope: 'all', tags: [src] })

  const touched: string[] = []
  for (const meta of matches) {
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
  }

  // Chỉ đụng base thực sự có entry bị chạm: `global/*` → global base,
  // `project/*` và `system/*` → project base.
  const touchedBases = new Set(touched.map((id) => bases[id.split('/')[0]]).filter(Boolean) as string[])
  for (const base of touchedBases) {
    const doc = await readCollectionsFile(base)
    if (dst) doc.tag_aliases = { ...doc.tag_aliases, [src]: dst }
    doc.collections = doc.collections.map((c) => ({
      ...c,
      tags: [...new Set((c.tags ?? []).map((t) => (t === src ? dst : t)).filter(Boolean))] as string[],
    }))
    await writeCollectionsFile(base, doc)
  }

  return { renamed: touched.length, entries: touched, alias: dst ? [src, dst] : null }
}
