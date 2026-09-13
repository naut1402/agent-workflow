import { eq } from 'drizzle-orm'
import { knowledgeCollections, knowledgeTagAliases } from './schema.js'
import { getDb } from './client.js'
import { globalKnowledgeRoot, loadRegistry } from '../registry.js'
import { access, joinPath, resolvePath } from '../lib/fileHelper.js'
import {
  COLLECTIONS_FILE,
  readCollectionsFile,
} from '../../features/knowledge/business/collectionsYaml.js'
import { knowledgeRoot } from '../../features/knowledge/business/fileDriver.js'

export type KnowledgeMigrationResult = {
  /** Đường dẫn store base — đúng khoá phân vùng (`store_key`) của bảng. */
  storeKey: string
  /** `collections.yaml` có trên đĩa và đọc được. */
  sourceExists: boolean
  /** Số hàng thực sự chèn được lần này. */
  collections: number
  aliases: number
  /** Hàng trong YAML đã có sẵn trong DB nên bỏ qua (chạy lần thứ hai trở đi). */
  skipped: number
}

/** Mọi store base có thể chứa `collections.yaml`, đã khử trùng lặp. */
function storesToScan(): { storeKey: string; scope: string }[] {
  const stores: { storeKey: string; scope: string }[] = []
  for (const project of loadRegistry().projects) {
    // `project.path` chính là thư mục `.dev-team-agent`; `knowledgeRoot()` là
    // cùng hàm mà driver dùng, nên khoá sinh ra ở đây khớp tuyệt đối với khoá
    // mà runtime tra sau này.
    stores.push({ storeKey: knowledgeRoot(project.path), scope: 'project' })
  }
  // Project mặc định qua `DEV_TEAM_ROOT` có thể chưa đăng ký trong registry —
  // bỏ sót nó là dashboard chạy xong migrate mà vẫn trống collection.
  const envRoot = process.env.DEV_TEAM_ROOT?.trim()
  if (envRoot) stores.push({ storeKey: knowledgeRoot(resolvePath(envRoot)), scope: 'project' })
  try {
    stores.push({ storeKey: globalKnowledgeRoot(), scope: 'global' })
  } catch {
    /* registry home không dựng được → bỏ store global, store khác vẫn chạy */
  }
  return [...new Map(stores.map((s) => [s.storeKey, s])).values()]
}

async function countRows(db: Awaited<ReturnType<typeof getDb>>, storeKey: string): Promise<number> {
  return db
    .select()
    .from(knowledgeCollections)
    .where(eq(knowledgeCollections.storeKey, storeKey))
    .all().length
}

/**
 * Chuyển collection + tag alias từ sidecar `collections.yaml` vào
 * `dashboard.sqlite`. Chạy tay: `bun run scripts/migrate-knowledge-to-sqlite.ts`.
 *
 * **Idempotent** — `UNIQUE(store_key, collection_id)` + `onConflictDoNothing()`:
 * chạy lại không thêm gì, và bản ghi đã sửa trên dashboard 🚫 không bị YAML cũ
 * ghi đè. (Khác `migrateLogs`, vốn không có khoá ổn định nào để chống trùng.)
 *
 * **Chỉ đọc nguồn** — `collections.yaml` ở lại trên đĩa làm bản lưu, đúng cách
 * `migrateLogs` đối xử với JSONL nguồn.
 */
export async function migrateKnowledgeToSqlite(): Promise<KnowledgeMigrationResult[]> {
  const db = await getDb()
  const results: KnowledgeMigrationResult[] = []

  for (const { storeKey, scope } of storesToScan()) {
    // Sidecar vốn là tuỳ chọn: store chưa từng có nhóm nào thì bỏ qua im lặng,
    // đừng báo thành lỗi.
    try {
      await access(joinPath(storeKey, COLLECTIONS_FILE))
    } catch {
      results.push({ storeKey, sourceExists: false, collections: 0, aliases: 0, skipped: 0 })
      continue
    }

    let doc: Awaited<ReturnType<typeof readCollectionsFile>>
    try {
      doc = await readCollectionsFile(storeKey)
    } catch (e) {
      // Sidecar hỏng: báo ra rồi đi tiếp — một project hỏng 🚫 không được chặn
      // mọi project còn lại.
      console.warn(`[knowledge] bỏ qua ${storeKey}: ${(e as Error)?.message ?? e}`)
      results.push({ storeKey, sourceExists: false, collections: 0, aliases: 0, skipped: 0 })
      continue
    }

    const aliasEntries = Object.entries(doc.tag_aliases ?? {}).filter(
      ([from, to]) => from && typeof to === 'string' && to,
    )
    const before = await countRows(db, storeKey)
    const now = new Date().toISOString()

    // Một transaction cho mỗi store: hỏng giữa chừng không để lại store nửa vời.
    db.transaction((tx) => {
      for (const c of doc.collections) {
        if (!c?.id) continue
        tx.insert(knowledgeCollections)
          .values({
            storeKey,
            scope,
            collectionId: c.id,
            name: c.name || c.id,
            description: c.description ?? '',
            tags: JSON.stringify(Array.isArray(c.tags) ? c.tags : []),
            entryIds: JSON.stringify(Array.isArray(c.entry_ids) ? c.entry_ids : []),
            createdAt: c.created_at ?? now,
            updatedAt: c.updated_at ?? now,
          })
          .onConflictDoNothing()
          .run()
      }
      for (const [fromTag, toTag] of aliasEntries) {
        tx.insert(knowledgeTagAliases)
          .values({ storeKey, fromTag, toTag })
          .onConflictDoNothing()
          .run()
      }
    })

    const inserted = (await countRows(db, storeKey)) - before
    results.push({
      storeKey,
      sourceExists: true,
      collections: inserted,
      aliases: aliasEntries.length,
      skipped: doc.collections.length - inserted,
    })
  }
  return results
}
