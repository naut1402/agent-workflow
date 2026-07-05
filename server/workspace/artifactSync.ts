import fs from 'node:fs'
import path from 'node:path'
import {
  ARTIFACT_SYNC_ALLOWED_EXACT_FILES,
  ARTIFACT_SYNC_ALLOWED_PREFIXES,
  ARTIFACT_SYNC_PRUNE_PREFIXES,
  isArtifactPathAllowed,
  type ArtifactFile,
} from '../../shared/schemas/artifact-sync.js'

// Chuẩn hoá + chặn path traversal. Trả về absolute path hợp lệ hoặc null.
// Áp dụng lớp phòng thủ đầu tiên trên chuỗi (chặn '../', absolute path, null
// byte, path ngoài whitelist) — lớp thứ hai (symlink escape qua realpath) nằm
// trong `writeArtifacts()` vì chỉ có thể kiểm tra sau khi mkdir.
export function resolveSafeArtifactPath(projectRoot: string, relPath: string): string | null {
  if (typeof relPath !== 'string' || !relPath) return null
  if (relPath.includes('\0')) return null
  if (path.isAbsolute(relPath)) return null
  const normalized = path.posix.normalize(relPath.replace(/\\/g, '/'))
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null
  if (!isArtifactPathAllowed(normalized)) return null

  const abs = path.resolve(projectRoot, normalized)
  const rootPrefix = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep
  if (abs !== projectRoot && !abs.startsWith(rootPrefix)) return null
  return abs
}

export type WriteArtifactsResult =
  | { ok: true; filesWritten: number; filesDeleted: number }
  | { ok: false; status: number; error: string }

export async function writeArtifacts(opts: {
  projectRoot: string
  files: ArtifactFile[]
}): Promise<WriteArtifactsResult> {
  // Pass 1 — validate TẤT CẢ path trước khi ghi bất kỳ file nào (all-or-nothing
  // ở mức validation; ghi từng file vẫn atomic riêng lẻ qua tmp+rename).
  const resolved: { abs: string; relNormalized: string; content: string }[] = []
  for (const f of opts.files) {
    const abs = resolveSafeArtifactPath(opts.projectRoot, f.relPath)
    if (!abs) return { ok: false, status: 400, error: `path not allowed: ${f.relPath}` }
    resolved.push({ abs, relNormalized: path.posix.normalize(f.relPath), content: f.content })
  }

  fs.mkdirSync(opts.projectRoot, { recursive: true })
  const rootReal = fs.realpathSync(opts.projectRoot)
  const rootRealPrefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep
  const keepByPrunePrefix = new Map<string, Set<string>>(
    ARTIFACT_SYNC_PRUNE_PREFIXES.map((p) => [p, new Set<string>()]),
  )

  let filesWritten = 0
  for (const item of resolved) {
    fs.mkdirSync(path.dirname(item.abs), { recursive: true })

    // Defense-in-depth: chặn symlink escape (mkdir theo path đã resolve, sau
    // đó xác nhận lại bằng realpath — path.resolve() một mình không phát
    // hiện được symlink trung gian nếu 1 thư mục con nào đó bị biến thành
    // symlink trỏ ra ngoài projectRoot).
    const realParent = fs.realpathSync(path.dirname(item.abs))
    if (realParent !== rootReal && !realParent.startsWith(rootRealPrefix)) {
      return { ok: false, status: 400, error: 'path escapes project root after resolving symlinks' }
    }

    const tmp = `${item.abs}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    fs.writeFileSync(tmp, item.content, 'utf8')
    fs.renameSync(tmp, item.abs) // atomic per-file write

    filesWritten++
    for (const prefix of ARTIFACT_SYNC_PRUNE_PREFIXES) {
      if (item.relNormalized.startsWith(prefix)) keepByPrunePrefix.get(prefix)!.add(item.abs)
    }
  }

  let filesDeleted = 0
  for (const [prefix, keep] of keepByPrunePrefix) {
    filesDeleted += pruneOrphans(path.join(opts.projectRoot, prefix), keep)
  }

  return { ok: true, filesWritten, filesDeleted }
}

function pruneOrphans(dirAbs: string, keep: Set<string>): number {
  if (!fs.existsSync(dirAbs)) return 0
  let deleted = 0
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        if (full !== dirAbs) {
          try {
            fs.rmdirSync(full)
          } catch {
            /* not empty — keep */
          }
        }
      } else if (!keep.has(full)) {
        fs.rmSync(full, { force: true })
        deleted++
      }
    }
  }
  walk(dirAbs)
  return deleted
}

function walkFiles(dirAbs: string): string[] {
  if (!fs.existsSync(dirAbs)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(full)
    }
  }
  walk(dirAbs)
  return out
}

// Đọc từ đĩa theo whitelist — dùng bởi `scripts/workspace-push.ts` (repo này)
// và là tài liệu tham chiếu cho `dashboard-sync.mjs` (plugin, PR riêng). Bỏ
// qua file không tồn tại (exact files đều tuỳ chọn).
export function collectArtifactFiles(devTeamRoot: string): ArtifactFile[] {
  const files: ArtifactFile[] = []

  for (const rel of ARTIFACT_SYNC_ALLOWED_EXACT_FILES) {
    const abs = path.join(devTeamRoot, rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
    files.push({ relPath: rel, content: fs.readFileSync(abs, 'utf8') })
  }

  for (const prefix of ARTIFACT_SYNC_ALLOWED_PREFIXES) {
    const dirAbs = path.join(devTeamRoot, prefix)
    for (const abs of walkFiles(dirAbs)) {
      const relPath = path.relative(devTeamRoot, abs).split(path.sep).join('/')
      files.push({ relPath, content: fs.readFileSync(abs, 'utf8') })
    }
  }

  return files
}
