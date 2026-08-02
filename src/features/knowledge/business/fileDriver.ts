import { access, basename, extname, joinPath, mkdir, readDir, readTextFile, unlink, writeTextFile } from '../../../core/lib/fileHelper.js'
import { loadYaml, dumpYaml } from '../../../core/lib/yamlLib.js'

const SCOPES = ['project', 'system']
const MAX_UPLOAD_BYTES = 512 * 1024

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

function parseEntryFile(raw: string, id: string, filePath: string) {
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
  const content = lines.slice(bodyStart).join('\n').replace(/^\n+/, '')
  const scope = fm.scope || id.split('/')[0] || 'project'
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

function serialiseEntry({ title, slug, scope, tags, content }) {
  const fm = {
    title: title || slug,
    slug,
    scope,
    tags: sanitiseTags(tags),
    updated_at: new Date().toISOString(),
  }
  return `---\n${dumpYaml(fm).trim()}\n---\n\n${content || ''}`
}

async function ensureDirs(root) {
  const base = knowledgeRoot(root)
  await mkdir(joinPath(base, 'project'), { recursive: true })
  await mkdir(joinPath(base, 'system'), { recursive: true })
  return base
}

function entryPath(base, scope, slug) {
  if (!SCOPES.includes(scope)) throw new Error('invalid scope')
  const clean = sanitiseSlug(slug)
  if (!clean) throw new Error('invalid slug')
  return { id: `${scope}/${clean}`, filePath: joinPath(base, scope, `${clean}.md`) }
}

async function walkEntries(base) {
  const entries = []
  for (const scope of SCOPES) {
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
        entries.push(parseEntryFile(raw, `${scope}/${slug}`, filePath))
      } catch {
        /* skip */
      }
    }
  }
  return entries
}

export function createFileDriver(devTeamRoot: string) {
  return {
    async list({ tags, scope, query }: { tags?: any; scope?: string; query?: string } = {}) {
      const base = await ensureDirs(devTeamRoot)
      let entries = await walkEntries(base)
      if (scope && SCOPES.includes(scope)) {
        entries = entries.filter((e) => e.scope === scope)
      }
      if (tags?.length) {
        const want = sanitiseTags(tags)
        entries = entries.filter((e) => want.every((t) => e.tags.includes(t)))
      }
      if (query) {
        const q = String(query).toLowerCase()
        entries = entries.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.id.toLowerCase().includes(q) ||
            e.content.toLowerCase().includes(q) ||
            e.tags.some((t) => t.includes(q)),
        )
      }
      return entries.map(({ content, path: _p, ...meta }) => meta)
    },

    async read(id) {
      const base = await ensureDirs(devTeamRoot)
      const [scope, ...rest] = String(id).split('/')
      const slug = rest.join('/') || scope
      const realScope = SCOPES.includes(scope) ? scope : 'project'
      const realSlug = SCOPES.includes(scope) ? rest.join('/') : scope
      const { filePath } = entryPath(base, realScope, realSlug)
      const raw = await readTextFile(filePath)
      return parseEntryFile(raw, `${realScope}/${sanitiseSlug(realSlug)}`, filePath)
    },

    async write({ id, title, slug, scope = 'project', tags, content }: { id?: string; title?: string; slug?: string; scope?: string; tags?: any; content?: string }) {
      const base = await ensureDirs(devTeamRoot)
      let targetScope = scope
      let targetSlug = slug
      if (id) {
        const [s, ...rest] = String(id).split('/')
        if (SCOPES.includes(s)) {
          targetScope = s
          targetSlug = rest.join('/')
        }
      }
      const { id: entryId, filePath } = entryPath(base, targetScope, targetSlug || title)
      const body = serialiseEntry({
        title: title || targetSlug,
        slug: sanitiseSlug(targetSlug || title),
        scope: targetScope,
        tags,
        content: content ?? '',
      })
      await writeTextFile(filePath, body)
      return this.read(entryId)
    },

    async upload({ filename, content, scope = 'project', tags, title }: { filename: string; content: string; scope?: string; tags?: any; title?: string }) {
      if (Buffer.byteLength(content, 'utf8') > MAX_UPLOAD_BYTES) {
        throw new Error('file too large (max 512KB)')
      }
      const base = await ensureDirs(devTeamRoot)
      const baseName = filename || 'upload'
      const ext = extname(baseName).toLowerCase()
      if (!['.md', '.txt', ''].includes(ext)) {
        throw new Error('only .md and .txt files allowed')
      }
      const slug = sanitiseSlug(baseName)
      const { id, filePath } = entryPath(base, scope, slug)
      try {
        await access(filePath)
        throw new Error(`entry already exists: ${id}`)
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }
      let body = content
      let metaTitle = title || slug
      let metaTags = tags
      if (ext === '.md' && content.trimStart().startsWith('---')) {
        const parsed = parseEntryFile(content, id, filePath)
        metaTitle = title || parsed.title
        metaTags = tags?.length ? tags : parsed.tags
        body = parsed.content
      }
      return this.write({ id, title: metaTitle, slug, scope, tags: metaTags, content: body })
    },

    async delete(id) {
      const base = await ensureDirs(devTeamRoot)
      const [scope, ...rest] = String(id).split('/')
      if (!SCOPES.includes(scope)) throw new Error('invalid id')
      const { filePath } = entryPath(base, scope, rest.join('/'))
      await unlink(filePath)
      return { deleted: true, id: `${scope}/${sanitiseSlug(rest.join('/'))}` }
    },

    async listTags() {
      const base = await ensureDirs(devTeamRoot)
      const entries = await walkEntries(base)
      const counts = {}
      for (const e of entries) {
        for (const t of e.tags) {
          counts[t] = (counts[t] || 0) + 1
        }
      }
      return Object.entries(counts)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => a.tag.localeCompare(b.tag))
    },
  }
}

export async function loadKnowledgeBundle(devTeamRoot, ids) {
  if (!ids?.length) return []
  const driver = createFileDriver(devTeamRoot)
  const bundle = []
  for (const id of ids) {
    try {
      const entry = await driver.read(id)
      bundle.push({ id: entry.id, title: entry.title, tags: entry.tags, content: entry.content })
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
