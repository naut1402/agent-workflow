import crypto from 'node:crypto'
import {
  chmodSafe,
  existsSync,
  joinPath,
  mkdirSync,
  readTextFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeTextFileSync,
  writeTextFileAtomicSync,
} from '../../../../backend/lib/fileHelper.js'
import { McpServer, type McpCliConfig } from '../../../mcp/business/index.js'
import { FileMcpDelivery, type McpConfigHandle } from './FileMcpDelivery.js'
import type { McpJobInput } from './McpJobDelivery.js'

const CURSOR_DIR = '.cursor'
const CURSOR_CONFIG = 'mcp.json'
const CURSOR_GITIGNORE = '.gitignore'
const CURSOR_LOCK = '.dashboard-lock'
const LEDGER_FILE = 'cursor-workspaces.json'

// xem docs/architecture/code/runner.md §26
type CursorWorkspaceStage =
  | 'locked'
  | 'written'

interface CursorWorkspaceEntry {
  jobId: string
  stage: CursorWorkspaceStage
  dir: string
  path: string
  lock: string
  backup: string | null
  dirExisted: boolean
  gitignoreCreated: boolean
  sha256: string
}

// xem docs/architecture/code/runner.md §24
/** Cursor: `<workspace>/.cursor/mcp.json`, CLI tự đọc theo cwd — argv chỉ thêm `--approve-mcps`. */
export class WorkspaceFileMcpDelivery extends FileMcpDelivery {
  readonly kind = 'workspace-config-file' as const

  protected write(config: McpCliConfig, input: McpJobInput): McpConfigHandle | null {
    const jobKey = McpServer.sanitiseId(input.jobId) ?? 'unknown'
    const dir = joinPath(input.workspace, CURSOR_DIR)
    const path = joinPath(dir, CURSOR_CONFIG)
    const gitignorePath = joinPath(dir, CURSOR_GITIGNORE)
    const lock = joinPath(dir, CURSOR_LOCK)

    const dirExisted = existsSync(dir)
    mkdirSync(dir, { recursive: true })

    const lockedEntry = (over: Partial<CursorWorkspaceEntry>): CursorWorkspaceEntry => ({
      jobId: input.jobId,
      stage: 'locked',
      dir,
      path,
      lock,
      backup: null,
      dirExisted,
      gitignoreCreated: false,
      sha256: '',
      ...over,
    })

    if (!acquireWorkspaceLock(lock)) {
      if (!dirExisted) tryRemoveEmptyDir(dir)
      input.onWarning?.(
        `mcp: ${dir} đang được một job khác dùng — job này chạy KHÔNG có MCP server `
        + '(🚫 không ghi đè cấu hình của lượt đang chạy)',
      )
      return null
    }

    // xem docs/architecture/code/runner.md §25
    this.rememberLedger(lockedEntry({}))

    // xem docs/architecture/code/runner.md §24
    if (!dirExisted) chmodSafe(dir, 0o700)

    const content = JSON.stringify(config.json, null, 2)
    const backup = existsSync(path) ? `${path}.dashboard-backup-${jobKey}` : null
    const entry = lockedEntry({
      stage: 'written',
      backup,
      gitignoreCreated: !existsSync(gitignorePath),
      sha256: sha256(content),
    })

    this.rememberLedger(entry)

    try {
      if (backup) renameSync(path, backup)
      writeTextFileSync(path, content, { mode: 0o600 })
      chmodSafe(path, 0o600)
      if (entry.gitignoreCreated) writeTextFileSync(gitignorePath, '*\n')
    } catch (err) {
      if (restoreWorkspace(entry)) this.forgetLedger(entry.jobId)
      throw err
    }

    const forget = (jobId: string) => this.forgetLedger(jobId)
    return {
      kind: this.kind,
      path,
      count: config.names.length,
      names: config.names,
      masker: config.masker,
      warnings: config.warnings,
      dispose() {
        // xem docs/architecture/code/runner.md §25
        if (restoreWorkspace(entry)) forget(entry.jobId)
      },
    }
  }

  // xem docs/architecture/code/runner.md §25
  override cleanupOrphans(): void {
    const entries = this.readLedger()
    if (!entries.length) return
    const stuck = entries.filter((entry) => {
      let clean = false
      attempt(() => {
        clean = restoreWorkspace(entry)
      })
      return !clean
    })
    this.writeLedger(stuck)
  }

  private ledgerPath(): string {
    return joinPath(this.runtimeDir(), LEDGER_FILE)
  }

  private readLedger(): CursorWorkspaceEntry[] {
    try {
      const parsed = JSON.parse(readTextFileSync(this.ledgerPath()))
      return Array.isArray(parsed?.entries) ? (parsed.entries as CursorWorkspaceEntry[]) : []
    } catch {
      return []
    }
  }

  private writeLedger(entries: CursorWorkspaceEntry[]): void {
    attempt(() => {
      const dir = this.runtimeDir()
      mkdirSync(dir, { recursive: true })
      chmodSafe(dir, 0o700)
      writeTextFileAtomicSync(this.ledgerPath(), JSON.stringify({ entries }, null, 2), { mode: 0o600 })
    })
  }

  private rememberLedger(entry: CursorWorkspaceEntry): void {
    this.writeLedger([...this.readLedger().filter((e) => e.jobId !== entry.jobId), entry])
  }

  private forgetLedger(jobId: string): void {
    this.writeLedger(this.readLedger().filter((e) => e.jobId !== jobId))
  }
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

// xem docs/architecture/code/runner.md §25
function acquireWorkspaceLock(lock: string): boolean {
  try {
    mkdirSync(lock)
    return true
  } catch {
    return false
  }
}

// xem docs/architecture/code/runner.md §26
function restoreWorkspace(entry: CursorWorkspaceEntry): boolean {
  const wroteConfig = entry.stage !== 'locked'
  let clean = true

  if (wroteConfig) {
    clean = false
    attempt(() => {
      if (!existsSync(entry.path) || isOurConfig(entry)) {
        rmSync(entry.path, { force: true })
        clean = true
      }
    })
  }

  if (entry.gitignoreCreated && clean) {
    attempt(() => rmSync(joinPath(entry.dir, CURSOR_GITIGNORE), { force: true }))
  }
  if (entry.backup) {
    attempt(() => {
      if (existsSync(entry.backup as string) && !existsSync(entry.path)) {
        renameSync(entry.backup as string, entry.path)
      }
    })
  }
  attempt(() => rmSync(entry.lock, { recursive: true, force: true }))
  if (!entry.dirExisted) attempt(() => tryRemoveEmptyDir(entry.dir))

  if (!clean) {
    console.warn(
      `[dev-team-dashboard] ${entry.path} đã bị sửa bởi tiến trình khác trong lúc job `
      + `${entry.jobId} chạy — 🚫 KHÔNG xoá để khỏi mất dữ liệu của bạn, nhưng file này `
      + 'CÓ THỂ còn chứa secret đã giải. Hãy kiểm tra rồi xoá tay.'
      + (entry.backup ? ` Bản gốc của bạn đang ở ${entry.backup}.` : ''),
    )
  }
  return clean
}

function isOurConfig(entry: CursorWorkspaceEntry): boolean {
  try {
    return sha256(readTextFileSync(entry.path)) === entry.sha256
  } catch {
    return false
  }
}

function tryRemoveEmptyDir(dir: string): void {
  if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true })
}

function attempt(fn: () => void): void {
  try {
    fn()
  } catch {
    /* dọn hụt không được làm hỏng kết quả job, cũng không được chặn bootstrap */
  }
}
