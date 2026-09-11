import { access, basename, extname, joinPath, readDir, readTextFile, unlink, writeTextFileAtomic } from '../../../backend/lib/fileHelper.js'
import { loadYaml, dumpYaml } from '../../../backend/lib/yamlLib.js'
import { globalKnowledgeRoot } from '../../../backend/registry.js'
import { KNOWLEDGE_SCOPES, MAX_BUNDLE_BYTES } from '../schemas/knowledge.js'
// Vòng import với `collections.js` chỉ ở mức hàm (không đọc binding lúc
// evaluate module), nên ESM giải được: collections cần driver để rewrite tag,
// driver cần collection để lọc `list({ collection })`.
import { readCollectionsFileSafe, resolveCollectionEntries } from './collections.js'

const SCOPES: readonly string[] = KNOWLEDGE_SCOPES
const MAX_UPLOAD_BYTES = 512 * 1024

export type KnowledgeBases = Partial<Record<string, string>>

export function knowledgeRoot(devTeamRoot) {
  return joinPath(devTeamRoot, 'knowledge')
}

function sanitiseSlug(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\.(md|txt)$/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s.slice(0, 80)
}

function sanitiseTags(tags) {
  if (!tags) return []
  const list = Array.isArray(tags) ? tags : String(tags).split(/[,;\s]+/)
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter((t) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(t)))]
}

export { sanitiseSlug, sanitiseTags }

/** Khoá front-matter mà API tự quản; mọi khoá khác là của người dùng. */
const KNOWN_FM_KEYS = ['title', 'slug', 'scope', 'tags', 'updated_at']

function parseFrontMatter(raw: string): { fm: any; content: string } {
  const lines = raw.split(/\r?\n/)
  let fm: any = {}
  let bodyStart = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
    if (end > 0) {
      try {
        fm = loadYaml(lines.slice(1, end).join('\n')) || {}
      } catch {
        fm = {}
      }
      bodyStart = end + 1
    }
  }
  return { fm, content: lines.slice(bodyStart).join('\n').replace(/^\n+/, '') }
}

/**
 * Khoá front-matter API không biết, đọc từ bản đang có trên đĩa.
 *
 * `write()` chỉ ghi 5 khoá cố định, nên không đọc lại phần dư là xoá mất thứ
 * người dùng tự thêm — và `renameTag` ghi lại **mọi** entry mang tag, biến nó
 * thành mất dữ liệu diện rộng chỉ bằng một request.
 */
async function readExtraFm(filePath: string): Promise<Record<string, unknown>> {
  try {
    const { fm } = parseFrontMatter(await readTextFile(filePath))
    return Object.fromEntries(Object.entries(fm).filter(([k]) => !KNOWN_FM_KEYS.includes(k)))
  } catch {
    return {}
  }
}

/**
 * `scopeHint` là scope suy ra từ **thư mục** chứa file. Nó thắng `fm.scope`:
 * thư mục quyết định đường dẫn thật, nên front-matter sửa tay mà lệch thì lọc
 * theo scope sẽ trỏ tới file không mở được.
 */
function parseEntryFile(raw: string, id: string, filePath: string, scopeHint?: string) {
  const { fm, content } = parseFrontMatter(raw)
  const scope = scopeHint || fm.scope || id.split('/')[0] || 'project'
  const slug = fm.slug || id.split('/').slice(1).join('/') || basename(filePath, '.md')
  return {
    id,
    slug,
    scope,
    title: fm.title || slug,
    tags: sanitiseTags(fm.tags),
    content,
    updated_at: fm.updated_at || null,
    path: filePath,
  }
}

function serialiseEntry({ title, slug, scope, tags, content, extra }) {
  const fm = {
    title: title || slug,
    slug,
    scope,
    tags: sanitiseTags(tags),
    updated_at: new Date().toISOString(),
    ...(extra || {}),
  }
  return `---\n${dumpYaml(fm).trim()}\n---\n\n${content || ''}`
}

let globalScopeWarned = false

/**
 * Bảng tra **`scope → base`** — thuần path, **không chạm đĩa**.
 *
 * Bảng tra là lớp chống path-traversal: scope được whitelist trước, base lấy
 * bằng tra bảng — không bao giờ nối `scope` do client gửi vào path.
 *
 * 🚫 Không mkdir ở đây. Đường ghi đã có `writeTextFileAtomic` tạo thư mục cha,
 * nên mkdir sẵn chỉ khiến **mỗi lượt đọc** đẻ thư mục rỗng trong registry home
 * — và làm test của driver phụ thuộc store global thật của máy đang chạy.
 * Thư mục scope chưa tồn tại thì `walkEntries` bỏ qua như thư mục rỗng.
 */
export function resolveBases(devTeamRoot): KnowledgeBases {
  const projectBase = knowledgeRoot(devTeamRoot)
  const bases: KnowledgeBases = { project: projectBase, system: projectBase }
  try {
    bases.global = globalKnowledgeRoot()
  } catch (e: any) {
    // Warn một lần: hàm này chạy ở đầu **mọi** thao tác, một vòng refresh của
    // panel đủ để log ngập cùng một dòng.
    if (!globalScopeWarned) {
      globalScopeWarned = true
      console.warn(`[knowledge] global scope disabled: ${e?.message ?? e}`)
    }
  }
  return bases
}

/** Các base khác nhau (project và system dùng chung một base) — cho `collections.yaml`. */
function distinctBases(bases: KnowledgeBases): string[] {
  return [...new Set(Object.values(bases).filter((b): b is string => Boolean(b)))]
}

function entryPath(bases: KnowledgeBases, scope, slug) {
  if (!SCOPES.includes(scope)) throw new Error('invalid scope')
  const base = bases[scope]
  if (!base) throw new Error('invalid scope')
  const clean = sanitiseSlug(slug)
  if (!clean) throw new Error('invalid slug')
  return { id: `${scope}/${clean}`, filePath: joinPath(base, scope, `${clean}.md`) }
}

/** `onlyScopes` để `list({ scope })` không quét root nó không cần. */
async function walkEntries(bases: KnowledgeBases, onlyScopes: readonly string[] = SCOPES) {
  const entries = []
  for (const scope of onlyScopes) {
    const base = bases[scope]
    if (!base) continue
    const dir = joinPath(base, scope)
    let files = []
    try {
      files = await readDir(dir)
    } catch {
      continue
    }
    for (const name of files) {
      if (!name.endsWith('.md')) continue
      const filePath = joinPath(dir, name)
      try {
        const raw = await readTextFile(filePath)
        const slug = name.replace(/\.md$/, '')
        entries.push(parseEntryFile(raw, `${scope}/${slug}`, filePath, scope))
      } catch {
        /* skip */
      }
    }
  }
  return entries
}

/** Scope lạ → **rỗng**, không phải "trả hết": lọc hụt nguy hiểm hơn lọc thừa. */
function resolveWantScopes(bases: KnowledgeBases, scope?: string): readonly string[] {
  const available = SCOPES.filter((s) => bases[s])
  if (!scope || scope === 'all') return available
  return available.includes(scope) ? [scope] : []
}

function countTags(entries) {
  const counts = {}
  for (const e of entries) {
    for (const t of e.tags) counts[t] = (counts[t] || 0) + 1
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
}

/**
 * Tag client gửi lên → tên **hiện hành**, theo alias trong `collections.yaml`.
 *
 * Không có bước này thì `?tags=` và bookmark của người dùng chết ngay sau một
 * lần rename — mà giữ alias chính là lý do `renameTag` ghi nó ra.
 */
async function resolveTagAliases(bases: KnowledgeBases, tags: string[]): Promise<string[]> {
  const aliases: Record<string, string> = {}
  for (const base of distinctBases(bases)) {
    Object.assign(aliases, (await readCollectionsFileSafe(base)).tag_aliases)
  }
  if (!Object.keys(aliases).length) return tags
  return [
    ...new Set(
      tags.map((tag) => {
        let cur = tag
        // Chuỗi a→b→c cần lặp; trần 8 để alias vòng không treo request.
        for (let i = 0; i < 8 && aliases[cur] && aliases[cur] !== cur; i++) cur = aliases[cur]
        return cur
      }),
    ),
  ]
}

async function applyFilters(bases: KnowledgeBases, entries, { tags, query, collection }: any) {
  let list = entries
  if (collection) {
    const found = await findCollection(bases, collection)
    list = found ? resolveCollectionEntries(found, list) : []
  }
  if (tags?.length) {
    const want = await resolveTagAliases(bases, sanitiseTags(tags))
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

async function findCollection(bases: KnowledgeBases, id: string) {
  for (const base of distinctBases(bases)) {
    const doc = await readCollectionsFileSafe(base)
    const hit = doc.collections.find((c) => c.id === id)
    if (hit) return hit
  }
  return null
}

const stripContent = ({ content: _c, path: _p, ...meta }) => meta

export function createFileDriver(devTeamRoot: string) {
  return {
    async list({ tags, scope, query, collection }: { tags?: any; scope?: string; query?: string; collection?: string } = {}) {
      const bases = resolveBases(devTeamRoot)
      const entries = await walkEntries(bases, resolveWantScopes(bases, scope))
      return (await applyFilters(bases, entries, { tags, query, collection })).map(stripContent)
    },

    /**
     * Một lượt walk trả cả entry và facet tag — panel cần cả hai mỗi lần load.
     *
     * Facet đếm trên tập **đã lọc scope** nhưng **trước** khi lọc tag/query:
     * đếm sau thì chọn một tag làm mọi tag khác về 0 và không chọn tiếp được.
     * `collection` cũng nằm ngoài phạm vi đếm vì cùng lý do — chip tag là số
     * của cả scope, không thu hẹp theo nhóm đang chọn.
     */
    async listWithTags({ tags, scope, query, collection }: { tags?: any; scope?: string; query?: string; collection?: string } = {}) {
      const bases = resolveBases(devTeamRoot)
      const scoped = await walkEntries(bases, resolveWantScopes(bases, scope))
      const tagFacets = countTags(scoped)
      const entries = (await applyFilters(bases, scoped, { tags, query, collection })).map(stripContent)
      return { entries, tags: tagFacets }
    },

    async read(id) {
      const bases = resolveBases(devTeamRoot)
      const [scope, ...rest] = String(id).split('/')
      const realScope = SCOPES.includes(scope) ? scope : 'project'
      const realSlug = SCOPES.includes(scope) ? rest.join('/') : scope
      const { filePath } = entryPath(bases, realScope, realSlug)
      const raw = await readTextFile(filePath)
      return parseEntryFile(raw, `${realScope}/${sanitiseSlug(realSlug)}`, filePath, realScope)
    },

    async write({ id, title, slug, scope = 'project', tags, content }: { id?: string; title?: string; slug?: string; scope?: string; tags?: any; content?: string }) {
      const bases = resolveBases(devTeamRoot)
      let targetScope = scope
      let targetSlug = slug
      if (id) {
        const [s, ...rest] = String(id).split('/')
        if (SCOPES.includes(s)) {
          targetScope = s
          targetSlug = rest.join('/')
        }
      }
      const { id: entryId, filePath } = entryPath(bases, targetScope, targetSlug || title)
      const body = serialiseEntry({
        title: title || targetSlug,
        slug: sanitiseSlug(targetSlug || title),
        scope: targetScope,
        tags,
        content: content ?? '',
        extra: await readExtraFm(filePath),
      })
      await writeTextFileAtomic(filePath, body)
      return this.read(entryId)
    },

    async upload({ filename, content, scope = 'project', tags, title }: { filename: string; content: string; scope?: string; tags?: any; title?: string }) {
      if (Buffer.byteLength(content, 'utf8') > MAX_UPLOAD_BYTES) {
        throw new Error('file too large (max 512KB)')
      }
      const bases = resolveBases(devTeamRoot)
      const baseName = filename || 'upload'
      const ext = extname(baseName).toLowerCase()
      if (!['.md', '.txt', ''].includes(ext)) {
        throw new Error('only .md and .txt files allowed')
      }
      const slug = sanitiseSlug(baseName)
      const { id, filePath } = entryPath(bases, scope, slug)
      try {
        await access(filePath)
        throw new Error(`entry already exists: ${id}`)
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }
      let body = content
      // `sanitiseSlug` loại dấu tiếng Việt nên slug KHÔNG dùng làm title được:
      // `Kiến trúc.md` sẽ hiện thành `ki-n-tr-c` và không còn đọc ra nghĩa.
      let metaTitle = title || baseName.replace(/\.(md|txt)$/i, '') || slug
      let metaTags = tags
      if (ext === '.md' && content.trimStart().startsWith('---')) {
        const parsed = parseEntryFile(content, id, filePath, scope)
        metaTitle = title || parsed.title
        metaTags = tags?.length ? tags : parsed.tags
        body = parsed.content
      }
      return this.write({ id, title: metaTitle, slug, scope, tags: metaTags, content: body })
    },

    async delete(id) {
      const bases = resolveBases(devTeamRoot)
      const [scope, ...rest] = String(id).split('/')
      if (!SCOPES.includes(scope)) throw new Error('invalid id')
      const { filePath } = entryPath(bases, scope, rest.join('/'))
      await unlink(filePath)
      return { deleted: true, id: `${scope}/${sanitiseSlug(rest.join('/'))}` }
    },

    async listTags() {
      const bases = resolveBases(devTeamRoot)
      return countTags(await walkEntries(bases))
    },
  }
}

/**
 * Resolve `knowledge_inputs` (id) → nội dung cho agent.
 *
 * Một id sai **không** làm hỏng cả bundle: item đó trả `{ id, error }`, phần
 * còn lại vẫn tới tay agent. `path` cho consumer đọc được đĩa (khung chat),
 * `content` cho consumer không có fs (MCP).
 */
export async function loadKnowledgeBundle(devTeamRoot, ids) {
  if (!ids?.length) return []
  const driver = createFileDriver(devTeamRoot)
  const bundle = []
  let bytes = 0
  for (const id of ids) {
    try {
      const entry = await driver.read(id)
      // Cộng **sau** khi nhận: cộng trước thì một entry to đẩy mọi entry đứng
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

// ── driver selection ───────────────────────────────────────────────────────

const SUPPORTED = ['file']

export async function loadKnowledgeConfig(devTeamRoot) {
  const configPath = joinPath(devTeamRoot, 'knowledge.config.yaml')
  try {
    const raw = await readTextFile(configPath)
    const cfg: any = loadYaml(raw) || {}
    const driver = cfg.driver || 'file'
    if (!SUPPORTED.includes(driver)) {
      return { driver: 'file', warning: `unsupported driver "${driver}", using file` }
    }
    return { driver, ...cfg }
  } catch {
    return { driver: 'file' }
  }
}

export async function getKnowledgeDriver(devTeamRoot) {
  const cfg = await loadKnowledgeConfig(devTeamRoot)
  if (cfg.driver === 'file') {
    return { driver: createFileDriver(devTeamRoot), config: cfg }
  }
  return { driver: createFileDriver(devTeamRoot), config: { driver: 'file' } }
}
