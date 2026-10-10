import crypto from 'node:crypto'
import { access, basename, extname, joinPath, readDir, readTextFile, unlink, writeTextFileAtomic } from '../../../../backend/lib/fileHelper.js'
import { loadYaml, dumpYaml } from '../../../../backend/lib/yamlLib.js'
import { slugify } from '../../../../shared/lib/stringUtils.js'
import { KNOWLEDGE_SCOPES } from '../../schemas/knowledge.js'
import {
  sanitiseTags,
  type KnowledgeDriver,
  type KnowledgeEntry,
  type KnowledgeUploadInput,
  type KnowledgeWriteInput,
} from '../KnowledgeDriver.js'

const SCOPES: readonly string[] = KNOWLEDGE_SCOPES
const MAX_UPLOAD_BYTES = 512 * 1024

/**
 * Bảng tra `scope → thư mục base` của driver file.
 *
 * Bảng tra là lớp chống path-traversal: scope được whitelist trước, base lấy
 * bằng tra bảng — không bao giờ nối `scope` do client gửi vào path.
 */
export type KnowledgeBases = Partial<Record<string, string>>

function sanitiseSlug(raw: unknown): string {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\.(md|txt)$/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s.slice(0, 80)
}

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
 * người dùng tự thêm — và `renameTag` ghi lại mọi entry mang tag, biến nó
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
 * `scopeHint` là scope suy ra từ thư mục chứa file. Nó thắng `fm.scope`:
 * thư mục quyết định đường dẫn thật, nên front-matter sửa tay mà lệch thì lọc
 * theo scope sẽ trỏ tới file không mở được.
 */
function parseEntryFile(raw: string, id: string, filePath: string, scopeHint?: string): KnowledgeEntry {
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

function serialiseEntry({ title, slug, scope, tags, content, extra }: {
  title: string
  slug: string
  scope: string
  tags: unknown
  content: string
  extra?: Record<string, unknown>
}) {
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

/**
 * Tách id `<scope>/<slug>`. `known` = phần đầu là scope hợp lệ; mỗi lối gọi
 * tự quyết khi `known` sai (read coi cả id là slug của `project`, write giữ
 * scope/slug từ tham số, delete ném lỗi) — ba luật đó là hành vi công khai.
 */
function splitId(id: unknown): { scope: string; slug: string; known: boolean } {
  const [scope, ...rest] = String(id).split('/')
  return { scope, slug: rest.join('/'), known: SCOPES.includes(scope) }
}

/** Trần độ dài của `sanitiseSlug`; hậu tố chống trùng phải nằm lọt trong đó. */
const SLUG_MAX = 80
/** `-` + 4 hex. */
const SLUG_SUFFIX_LEN = 5

/**
 * Driver lưu mỗi entry thành một file `<base>/<scope>/<slug>.md` có
 * front-matter.
 *
 * `bases` do chỗ lắp ráp truyền vào (`knowledgeDriverRegistry.ts`). Driver
 * không mkdir khi đọc: đường ghi đã có `writeTextFileAtomic` tạo thư mục cha,
 * nên mkdir sẵn chỉ khiến mỗi lượt đọc đẻ thư mục rỗng trong registry home.
 * Thư mục scope chưa tồn tại thì `listEntries` bỏ qua như thư mục rỗng.
 */
export class FileKnowledgeDriver implements KnowledgeDriver {
  constructor(private readonly bases: KnowledgeBases) {}

  scopes(): readonly string[] {
    return SCOPES.filter((s) => this.bases[s])
  }

  private entryPath(scope: string, slug: unknown) {
    if (!SCOPES.includes(scope)) throw new Error('invalid scope')
    const base = this.bases[scope]
    if (!base) throw new Error('invalid scope')
    const clean = sanitiseSlug(slug)
    if (!clean) throw new Error('invalid slug')
    return { id: `${scope}/${clean}`, filePath: joinPath(base, scope, `${clean}.md`) }
  }

  /**
   * Slug chưa dùng trong scope — chỉ cho đường tạo mới.
   *
   * Hai entry cùng title trước đây ghi đè nhau im lặng: slug suy từ title là
   * tên file, không có bước kiểm tra nào. Hậu tố ngẫu nhiên ngắn và **chỉ khi
   * trùng** để id vẫn đọc được (`kien-truc`, rồi `kien-truc-a3f1`).
   *
   * Phần thân phải cắt sẵn về `SLUG_MAX - SLUG_SUFFIX_LEN`: `entryPath` sẽ
   * `sanitiseSlug` lần nữa và cắt còn `SLUG_MAX`, nên nếu ghép hậu tố vào một
   * seed đã sát trần thì (a) giá trị trả về khác hẳn thứ nằm trên đĩa ⇒
   * front-matter `slug` lệch tên file, và (b) với seed đúng `SLUG_MAX` thì mọi
   * candidate bị cắt về lại chính seed ⇒ vòng lặp không bao giờ tìm ra chỗ trống
   * và title dài thứ hai không tạo được entry.
   */
  private async uniqueSlug(scope: string, seed: string): Promise<string> {
    // Sanitise ngay ở đây để giá trị trả về bằng đúng thứ `entryPath` dựng ra.
    const base = sanitiseSlug(seed)
    const stem = base.slice(0, SLUG_MAX - SLUG_SUFFIX_LEN).replace(/-+$/, '')
    for (let i = 0; i < 5; i++) {
      const candidate = i === 0 ? base : `${stem}-${crypto.randomBytes(2).toString('hex')}`
      const { filePath } = this.entryPath(scope, candidate)
      try {
        await access(filePath)
      } catch (e: any) {
        // Chỉ ENOENT mới là "chỗ trống"; lỗi quyền phải nổi lên chứ không được
        // hiểu thành có thể ghi đè.
        if (e?.code === 'ENOENT') return candidate
        throw e
      }
    }
    throw new Error('không sinh được slug chưa dùng')
  }

  async listEntries(onlyScopes: readonly string[] = SCOPES): Promise<KnowledgeEntry[]> {
    const entries: KnowledgeEntry[] = []
    for (const scope of onlyScopes) {
      const base = this.bases[scope]
      if (!base) continue
      const dir = joinPath(base, scope)
      let files: string[] = []
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

  async read(id: string): Promise<KnowledgeEntry> {
    const parts = splitId(id)
    const realScope = parts.known ? parts.scope : 'project'
    const realSlug = parts.known ? parts.slug : parts.scope
    const { filePath } = this.entryPath(realScope, realSlug)
    const raw = await readTextFile(filePath)
    return parseEntryFile(raw, `${realScope}/${sanitiseSlug(realSlug)}`, filePath, realScope)
  }

  async write({ id, title, slug, scope = 'project', tags, content }: KnowledgeWriteInput): Promise<KnowledgeEntry> {
    let targetScope = scope
    let targetSlug = slug
    if (id) {
      const parts = splitId(id)
      if (parts.known) {
        targetScope = parts.scope
        targetSlug = parts.slug
      }
    }

    // `finalSlug` phải tính đúng MỘT lần rồi dùng lại: `entryPath` và
    // `serialiseEntry` mà mỗi bên tự tính sẽ ra hai giá trị khác nhau sau khi
    // có hậu tố chống trùng, và front-matter `slug` lệch tên file trên đĩa.
    let finalSlug: string
    if (id) {
      // Đường sửa: slug lấy từ `id`, tham số `slug` client gửi bị bỏ qua.
      finalSlug = sanitiseSlug(targetSlug || title)
    } else {
      // Đường tạo mới: slug là phần nội suy, dialog không còn ô nhập.
      // `sanitiseSlug(title)` băm nát tiếng Việt (`Giảm số token` →
      // `gi-m-s-token`), nên đi qua `slugify` — có NFD + map đ→d — trước.
      const seed = sanitiseSlug(slug || '') || slugify(title || '', { maxLength: 80, fallback: 'entry' })
      finalSlug = await this.uniqueSlug(targetScope, seed)
    }

    const { id: entryId, filePath } = this.entryPath(targetScope, finalSlug)
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
  }

  async upload({ filename, content, scope = 'project', tags, title }: KnowledgeUploadInput): Promise<KnowledgeEntry> {
    if (Buffer.byteLength(content, 'utf8') > MAX_UPLOAD_BYTES) {
      throw new Error('file too large (max 512KB)')
    }
    const baseName = filename || 'upload'
    const ext = extname(baseName).toLowerCase()
    if (!['.md', '.txt', ''].includes(ext)) {
      throw new Error('only .md and .txt files allowed')
    }
    const slug = sanitiseSlug(baseName)
    const { id, filePath } = this.entryPath(scope, slug)
    try {
      await access(filePath)
      throw new Error(`entry already exists: ${id}`)
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e
    }
    let body = content
    // `sanitiseSlug` loại dấu tiếng Việt nên slug KHÔNG dùng làm title được:
    // `Kiến trúc.md` sẽ hiện thành `ki-n-tr-c` và không còn đọc ra nghĩa.
    let metaTitle = title || baseName.replace(/\.(md|txt)$/i, '') || slug
    let metaTags: unknown = tags
    if (ext === '.md' && content.trimStart().startsWith('---')) {
      const parsed = parseEntryFile(content, id, filePath, scope)
      metaTitle = title || parsed.title
      metaTags = tags?.length ? tags : parsed.tags
      body = parsed.content
    }
    return this.write({ id, title: metaTitle, slug, scope, tags: metaTags, content: body })
  }

  async delete(id: string): Promise<{ deleted: true; id: string }> {
    const parts = splitId(id)
    if (!parts.known) throw new Error('invalid id')
    const { filePath } = this.entryPath(parts.scope, parts.slug)
    await unlink(filePath)
    return { deleted: true, id: `${parts.scope}/${sanitiseSlug(parts.slug)}` }
  }
}
