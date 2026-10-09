import crypto from 'node:crypto'
import { access, basename, extname, joinPath, readDir, readTextFile, unlink, writeTextFileAtomic } from '../../../backend/lib/fileHelper.js'
import { loadYaml, dumpYaml } from '../../../backend/lib/yamlLib.js'
import { globalKnowledgeRoot } from '../../../backend/registry.js'
import { slugify } from '../../../shared/lib/stringUtils.js'
import { KNOWLEDGE_SCOPES, MAX_BUNDLE_BYTES } from '../schemas/knowledge.js'
// xem docs/architecture/code/knowledge.md §1
import { findCollectionSafe, resolveCollectionEntries } from './collections.js'
import { decorateTagFacets, readTagAliasesSafe } from './tags.js'

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

// xem docs/architecture/code/knowledge.md §4
async function readExtraFm(filePath: string): Promise<Record<string, unknown>> {
  try {
    const { fm } = parseFrontMatter(await readTextFile(filePath))
    return Object.fromEntries(Object.entries(fm).filter(([k]) => !KNOWN_FM_KEYS.includes(k)))
  } catch {
    return {}
  }
}

// xem docs/architecture/code/knowledge.md §2
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
 * Bảng tra `scope → base` — thuần path, không chạm đĩa.
 * xem docs/architecture/code/knowledge.md §2
 */
export function resolveBases(devTeamRoot): KnowledgeBases {
  const projectBase = knowledgeRoot(devTeamRoot)
  const bases: KnowledgeBases = { project: projectBase, system: projectBase }
  try {
    bases.global = globalKnowledgeRoot()
  } catch (e: any) {
    if (!globalScopeWarned) {
      globalScopeWarned = true
      console.warn(`[knowledge] global scope disabled: ${e?.message ?? e}`)
    }
  }
  return bases
}

function entryPath(bases: KnowledgeBases, scope, slug) {
  if (!SCOPES.includes(scope)) throw new Error('invalid scope')
  const base = bases[scope]
  if (!base) throw new Error('invalid scope')
  const clean = sanitiseSlug(slug)
  if (!clean) throw new Error('invalid slug')
  return { id: `${scope}/${clean}`, filePath: joinPath(base, scope, `${clean}.md`) }
}

const SLUG_MAX = 80
const SLUG_SUFFIX_LEN = 5

// xem docs/architecture/code/knowledge.md §3
async function uniqueSlug(bases: KnowledgeBases, scope: string, seed: string): Promise<string> {
  const base = sanitiseSlug(seed)
  const stem = base.slice(0, SLUG_MAX - SLUG_SUFFIX_LEN).replace(/-+$/, '')
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${stem}-${crypto.randomBytes(2).toString('hex')}`
    const { filePath } = entryPath(bases, scope, candidate)
    try {
      await access(filePath)
    } catch (e: any) {
      if (e?.code === 'ENOENT') return candidate
      throw e
    }
  }
  throw new Error('không sinh được slug chưa dùng')
}

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

function resolveWantScopes(bases: KnowledgeBases, scope?: string): readonly string[] {
  const available = SCOPES.filter((s) => bases[s])
  if (!scope || scope === 'all') return available
  return available.includes(scope) ? [scope] : []
}

function countTags(entries): { tag: string; count: number }[] {
  const counts: Record<string, number> = {}
  for (const e of entries) {
    for (const t of e.tags) counts[t] = (counts[t] || 0) + 1
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
}

async function resolveTagAliases(devTeamRoot: string, tags: string[]): Promise<string[]> {
  const aliases = await readTagAliasesSafe(devTeamRoot)
  if (!Object.keys(aliases).length) return tags
  return [
    ...new Set(
      tags.map((tag) => {
        let cur = tag
        for (let i = 0; i < 8 && aliases[cur] && aliases[cur] !== cur; i++) cur = aliases[cur]
        return cur
      }),
    ),
  ]
}

async function applyFilters(devTeamRoot: string, entries, { tags, query, collection }: any) {
  let list = entries
  if (collection) {
    const found = await findCollectionSafe(devTeamRoot, collection)
    list = found ? resolveCollectionEntries(found, list) : []
  }
  if (tags?.length) {
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

const stripContent = ({ content: _c, path: _p, ...meta }) => meta

export function createFileDriver(devTeamRoot: string) {
  return {
    async list({ tags, scope, query, collection }: { tags?: any; scope?: string; query?: string; collection?: string } = {}) {
      const bases = resolveBases(devTeamRoot)
      const entries = await walkEntries(bases, resolveWantScopes(bases, scope))
      return (await applyFilters(devTeamRoot, entries, { tags, query, collection })).map(stripContent)
    },

    // xem docs/architecture/code/knowledge.md §5
    async listWithTags({ tags, scope, query, collection }: { tags?: any; scope?: string; query?: string; collection?: string } = {}) {
      const bases = resolveBases(devTeamRoot)
      const scoped = await walkEntries(bases, resolveWantScopes(bases, scope))
      const tagFacets = await decorateTagFacets(devTeamRoot, countTags(scoped))
      const entries = (await applyFilters(devTeamRoot, scoped, { tags, query, collection })).map(stripContent)
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

      // xem docs/architecture/code/knowledge.md §3
      let finalSlug: string
      if (id) {
        finalSlug = sanitiseSlug(targetSlug || title)
      } else {
        const seed = sanitiseSlug(slug || '') || slugify(title || '', { maxLength: 80, fallback: 'entry' })
        finalSlug = await uniqueSlug(bases, targetScope, seed)
      }

      const { id: entryId, filePath } = entryPath(bases, targetScope, finalSlug)
      const body = serialiseEntry({
        title: title || finalSlug,
        slug: finalSlug,
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
 * Một id sai không làm hỏng cả bundle: item đó trả `{ id, error }`, phần
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
