import { MAX_BUNDLE_BYTES, type KnowledgeBundleItem } from '../schemas/knowledge.js'
import { findCollectionSafe, resolveCollectionEntries } from './collections.js'
import { sanitiseTags, type KnowledgeDriver, type KnowledgeEntry, type KnowledgeEntryMeta } from './KnowledgeDriver.js'
import { getKnowledgeDriver } from './knowledgeDriverRegistry.js'
import { decorateTagFacets, resolveTagAliases, type KnowledgeTagFacet } from './tags.js'

/**
 * Rule đọc entry — lọc, facet tag, bundle cho agent — chỉ dựa trên
 * `KnowledgeDriver`, nên driver thứ hai không phải chép lại gì ở đây.
 */

export interface KnowledgeListFilter {
  /** Mảng hoặc CSV; tên cũ được giải qua alias trước khi so. */
  tags?: unknown
  /** `all` / bỏ trống = mọi scope driver đang có. */
  scope?: string
  query?: string
  collection?: string
}

/** Scope lạ → rỗng, không phải "trả hết": lọc hụt nguy hiểm hơn lọc thừa. */
function resolveWantScopes(driver: KnowledgeDriver, scope?: string): readonly string[] {
  const available = driver.scopes()
  if (!scope || scope === 'all') return available
  return available.includes(scope) ? [scope] : []
}

function countTags(entries: { tags: string[] }[]): { tag: string; count: number }[] {
  const counts: Record<string, number> = {}
  for (const e of entries) {
    for (const t of e.tags) counts[t] = (counts[t] || 0) + 1
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
}

async function applyFilters(
  devTeamRoot: string,
  entries: KnowledgeEntry[],
  { tags, query, collection }: KnowledgeListFilter,
): Promise<KnowledgeEntry[]> {
  let list = entries
  if (collection) {
    const found = await findCollectionSafe(devTeamRoot, collection)
    list = found ? resolveCollectionEntries(found, list) : []
  }
  if ((tags as { length?: number } | undefined)?.length) {
    const want = await resolveTagAliases(devTeamRoot, sanitiseTags(tags))
    list = list.filter((e) => want.every((t) => e.tags.includes(t)))
  }
  if (query) {
    const q = String(query).toLowerCase()
    list = list.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.tags.some((t) => t.includes(q)),
    )
  }
  return list
}

const stripContent = ({ content: _c, path: _p, ...meta }: KnowledgeEntry): KnowledgeEntryMeta => meta

export async function listKnowledge(
  driver: KnowledgeDriver,
  devTeamRoot: string,
  { tags, scope, query, collection }: KnowledgeListFilter = {},
): Promise<KnowledgeEntryMeta[]> {
  const entries = await driver.listEntries(resolveWantScopes(driver, scope))
  return (await applyFilters(devTeamRoot, entries, { tags, query, collection })).map(stripContent)
}

/**
 * Một lượt walk trả cả entry và facet tag — panel cần cả hai mỗi lần load.
 *
 * Facet đếm trên tập đã lọc scope nhưng trước khi lọc tag/query:
 * đếm sau thì chọn một tag làm mọi tag khác về 0 và không chọn tiếp được.
 * `collection` cũng nằm ngoài phạm vi đếm vì cùng lý do — chip tag là số
 * của cả scope, không thu hẹp theo nhóm đang chọn.
 *
 * Facet đi kèm `color`/`description` từ DB và kèm cả tag **chưa entry nào
 * gắn**: panel nạp facet qua đúng request này, không được gọi thêm
 * `/api/knowledge/tags`.
 */
export async function listKnowledgeWithTags(
  driver: KnowledgeDriver,
  devTeamRoot: string,
  { tags, scope, query, collection }: KnowledgeListFilter = {},
): Promise<{ entries: KnowledgeEntryMeta[]; tags: KnowledgeTagFacet[] }> {
  const scoped = await driver.listEntries(resolveWantScopes(driver, scope))
  const tagFacets = await decorateTagFacets(devTeamRoot, countTags(scoped))
  const entries = (await applyFilters(devTeamRoot, scoped, { tags, query, collection })).map(stripContent)
  return { entries, tags: tagFacets }
}

/** Facet tag trên mọi scope, chưa gắn metadata (xem `decorateTagFacets`). */
export async function listKnowledgeTags(driver: KnowledgeDriver): Promise<{ tag: string; count: number }[]> {
  return countTags(await driver.listEntries(driver.scopes()))
}

/**
 * Resolve `knowledge_inputs` (id) → nội dung cho agent.
 *
 * Một id sai không làm hỏng cả bundle: item đó trả `{ id, error }`, phần
 * còn lại vẫn tới tay agent. `path` cho consumer đọc được đĩa (khung chat),
 * `content` cho consumer không có fs (MCP).
 */
export async function loadKnowledgeBundle(devTeamRoot: string, ids: string[] | null | undefined): Promise<KnowledgeBundleItem[]> {
  if (!ids?.length) return []
  const { driver } = await getKnowledgeDriver(devTeamRoot)
  const bundle: KnowledgeBundleItem[] = []
  let bytes = 0
  for (const id of ids) {
    try {
      const entry = await driver.read(id)
      // Cộng sau khi nhận: cộng trước thì một entry to đẩy mọi entry đứng
      // sau nó vào lỗi, dù tổng nội dung dùng được còn dưới ngưỡng.
      const size = Buffer.byteLength(entry.content ?? '', 'utf8')
      if (bytes + size > MAX_BUNDLE_BYTES) {
        bundle.push({ id, error: 'bundle size limit' })
        continue
      }
      bytes += size
      bundle.push({ id: entry.id, title: entry.title, tags: entry.tags, content: entry.content, path: entry.path })
    } catch {
      bundle.push({ id, error: 'not found' })
    }
  }
  return bundle
}
