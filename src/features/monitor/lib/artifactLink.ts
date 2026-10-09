/** Kết quả phân loại một href trong artifact đã render. */
export type ArtifactLinkTarget =
  /** Neo `#`, href rỗng, scheme vô hại khác — để trình duyệt tự xử lý. */
  | { kind: 'ignore' }
  /** http/https/protocol-relative — mở tab mới để không phá SPA. */
  | { kind: 'external'; href: string }
  /** Path đã normalize, tương đối so với thư mục task. */
  | { kind: 'artifact'; name: string }
  | { kind: 'invalid'; reason: 'escape' | 'not-markdown' | 'unsafe' }

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const UNSAFE_SCHEMES = ['javascript:', 'data:', 'vbscript:']
// xem docs/architecture/code/monitor.md §22
function stripBlanks(s: string): string {
  let out = ''
  for (const ch of s) {
    if (ch.charCodeAt(0) > 0x20) out += ch
  }
  return out
}

function dirOf(name: string): string {
  const at = name.lastIndexOf('/')
  return at < 0 ? '' : name.slice(0, at)
}

function normalizeArtifactPath(baseDir: string, relative: string): string | null {
  const stack: string[] = []
  for (const seg of [...baseDir.split('/'), ...relative.split('/')]) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    stack.push(seg)
  }
  return stack.length ? stack.join('/') : null
}

// xem docs/architecture/code/monitor.md §22
function isArtifactName(name: string): boolean {
  if (!name.endsWith('.md')) return false
  return !name.split('/').some((seg) => seg.startsWith('.'))
}

/**
 * @param href href thô lấy từ thẻ `a` đã render.
 * @param currentName tên artifact đang mở, tương đối so với thư mục task.
 */
export function classifyArtifactHref(
  href: string | null | undefined,
  currentName: string,
): ArtifactLinkTarget {
  const raw = (href ?? '').trim()
  if (!raw || raw.startsWith('#')) return { kind: 'ignore' }

  const bare = stripBlanks(raw.toLowerCase())
  if (UNSAFE_SCHEMES.some((s) => bare.startsWith(s))) {
    return { kind: 'invalid', reason: 'unsafe' }
  }
  if (/^https?:/i.test(raw) || raw.startsWith('//')) return { kind: 'external', href: raw }
  if (SCHEME_RE.test(raw)) return { kind: 'ignore' }

  const cut = raw.search(/[#?]/)
  const pathPart = cut < 0 ? raw : raw.slice(0, cut)
  if (!pathPart) return { kind: 'ignore' }

  let decoded: string
  try {
    decoded = decodeURIComponent(pathPart)
  } catch {
    decoded = pathPart
  }

  if (decoded.startsWith('/')) return { kind: 'invalid', reason: 'escape' }

  const name = normalizeArtifactPath(dirOf(currentName), decoded)
  if (name === null) return { kind: 'invalid', reason: 'escape' }
  if (!isArtifactName(name)) return { kind: 'invalid', reason: 'not-markdown' }
  return { kind: 'artifact', name }
}
