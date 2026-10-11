import { eq } from 'drizzle-orm'
import { getDb } from '../../../backend/db/client.js'
import { knowledgeCollections, knowledgeTagAliases } from '../../../backend/db/schema.js'
import { access, joinPath, readTextFile, resolvePath } from '../../../backend/lib/fileHelper.js'
import { loadYaml } from '../../../backend/lib/yamlLib.js'
import { globalKnowledgeRoot, loadRegistry } from '../../../backend/registry.js'
import { storeKeysOf } from './knowledgeDb.js'

/**
 * Sidecar `collections.yaml` và lệnh migrate nó sang `dashboard.sqlite`
 * (`migrateKnowledgeToSqlite`, chạy tay qua
 * `scripts/migrate-knowledge-to-sqlite.ts`).
 *
 * Từ khi collection và tag lên `dashboard.sqlite`, file này thôi là nguồn sự
 * thật. Nó ở lại trên đĩa làm bản lưu (đúng cách `migrateLogs` đối xử với
 * JSONL nguồn), nên module này cố ý chỉ đọc: không còn đường ghi nào.
 */

export const COLLECTIONS_FILE = 'collections.yaml'

export interface YamlCollection {
  id: string
  name: string
  description?: string
  tags?: string[]
  entry_ids?: string[]
  created_at?: string
  updated_at?: string
}

export interface CollectionsDoc {
  version: number
  collections: YamlCollection[]
  tag_aliases: Record<string, string>
}

/** Sidecar không parse được — lệnh migrate phải dừng chứ không được coi là rỗng. */
export class CollectionsFileError extends Error {
  constructor(
    readonly base: string,
    cause?: unknown,
  ) {
    super(`collections.yaml không đọc được (${base}): ${(cause as Error)?.message ?? cause}`)
    this.name = 'CollectionsFileError'
  }
}

function emptyDoc(): CollectionsDoc {
  return { version: 1, collections: [], tag_aliases: {} }
}

/**
 * Thiếu file → doc rỗng (sidecar vốn là tuỳ chọn). Parse hỏng → ném.
 *
 * Hai ca này không được gộp: coi file hỏng là rỗng thì lệnh migrate báo
 * "0 collection" và người dùng tưởng project không có gì để chuyển, trong khi
 * dữ liệu vẫn nằm nguyên trên đĩa.
 */
export async function readCollectionsFile(base: string): Promise<CollectionsDoc> {
  let raw: string
  try {
    raw = await readTextFile(joinPath(base, COLLECTIONS_FILE))
  } catch {
    return emptyDoc()
  }
  let doc: any
  try {
    doc = loadYaml(raw) || {}
  } catch (e) {
    throw new CollectionsFileError(base, e)
  }
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new CollectionsFileError(base, 'nội dung không phải mapping YAML')
  }
  return {
    version: Number(doc.version) || 1,
    collections: Array.isArray(doc.collections) ? doc.collections : [],
    tag_aliases: doc.tag_aliases && typeof doc.tag_aliases === 'object' ? doc.tag_aliases : {},
  }
}

// ── lệnh migrate YAML → SQLite

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
  // `project.path` chính là thư mục `.dev-team-agent`. Khoá lấy qua
  // `storeKeysOf` — cùng hàm runtime dùng để tra — nên khoá sinh ra ở đây khớp
  // tuyệt đối với khoá mà collection/tag tra sau này.
  const projectKey = (devTeamRoot: string) => storeKeysOf(devTeamRoot).byScope.project
  for (const project of loadRegistry().projects) {
    const storeKey = projectKey(project.path)
    if (storeKey) stores.push({ storeKey, scope: 'project' })
  }
  // Project mặc định qua `DEV_TEAM_ROOT` có thể chưa đăng ký trong registry —
  // bỏ sót nó là dashboard chạy xong migrate mà vẫn trống collection.
  const envRoot = process.env.DEV_TEAM_ROOT?.trim()
  if (envRoot) {
    const storeKey = projectKey(resolvePath(envRoot))
    if (storeKey) stores.push({ storeKey, scope: 'project' })
  }
  try {
    // Không đi qua `storeKeysOf`: store global phải được quét kể cả khi
    // registry không có project nào.
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
 * Idempotent — `UNIQUE(store_key, collection_id)` + `onConflictDoNothing()`:
 * chạy lại không thêm gì, và bản ghi đã sửa trên dashboard không bị YAML cũ
 * ghi đè. (Khác `migrateLogs`, vốn không có khoá ổn định nào để chống trùng.)
 *
 * Chỉ đọc nguồn — `collections.yaml` ở lại trên đĩa làm bản lưu, đúng cách
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

    let doc: CollectionsDoc
    try {
      doc = await readCollectionsFile(storeKey)
    } catch (e) {
      // Sidecar hỏng: báo ra rồi đi tiếp — một project hỏng không được chặn
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
