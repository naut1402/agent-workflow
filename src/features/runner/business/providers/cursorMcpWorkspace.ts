// xem docs/architecture/code/runner.md §12

import crypto from 'node:crypto'
import {
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
import { registryHome } from '../../../../backend/registry.js'
import { McpServer } from '../../../mcp/business/index.js'
import {
  resolveJobMcpServers,
  tryChmod,
  type McpJobConfigHandle,
  type PrepareMcpConfigInput,
} from './mcpJobConfig.js'

const CURSOR_DIR = '.cursor'
const CURSOR_CONFIG = 'mcp.json'
const CURSOR_GITIGNORE = '.gitignore'
const CURSOR_LOCK = '.dashboard-lock'
const LEDGER_FILE = 'cursor-workspaces.json'

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

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

// xem docs/architecture/code/runner.md §13
function acquireWorkspaceLock(lock: string): boolean {
  try {
    mkdirSync(lock)
    return true
  } catch {
    return false
  }
}

export function prepareCursorMcpWorkspace(input: PrepareMcpConfigInput): McpJobConfigHandle | null {
  const resolved = resolveJobMcpServers(input)
  if (!resolved) return null

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

  // xem docs/architecture/code/runner.md §13
  rememberLedger(lockedEntry({}))

  // xem docs/architecture/code/runner.md §12
  if (!dirExisted) tryChmod(dir, 0o700)

  const content = JSON.stringify(resolved.json, null, 2)
  const backup = existsSync(path) ? `${path}.dashboard-backup-${jobKey}` : null
  const entry = lockedEntry({
    stage: 'written',
    backup,
    gitignoreCreated: !existsSync(gitignorePath),
    sha256: sha256(content),
  })

  rememberLedger(entry)

  try {
    if (backup) renameSync(path, backup)
    writeTextFileSync(path, content, { mode: 0o600 })
    tryChmod(path, 0o600)
    if (entry.gitignoreCreated) writeTextFileSync(gitignorePath, '*\n')
  } catch (err) {
    if (restoreWorkspace(entry)) forgetLedger(entry.jobId)
    throw err
  }

  return {
    kind: 'workspace-config-file',
    path,
    count: resolved.names.length,
    names: resolved.names,
    secrets: resolved.secrets,
    warnings: resolved.warnings,
    dispose() {
      // xem docs/architecture/code/runner.md §13
      if (restoreWorkspace(entry)) forgetLedger(entry.jobId)
    },
  }
}

// xem docs/architecture/code/runner.md §14
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

/**
 * Dọn các lượt ghi mồ côi trong ledger (file cấu hình, bản sao lưu, khoá) lúc
 * bootstrap; entry chưa dọn sạch được giữ lại cho lần sau.
 */
export function cleanupOrphanedCursorMcpWorkspaces(): void {
  const entries = readLedger()
  if (!entries.length) return
  const stuck = entries.filter((entry) => {
    let clean = false
    attempt(() => {
      clean = restoreWorkspace(entry)
    })
    return !clean
  })
  writeLedger(stuck)
}

function ledgerPath(): string {
  return joinPath(registryHome(), 'mcp-runtime', LEDGER_FILE)
}

function readLedger(): CursorWorkspaceEntry[] {
  try {
    const parsed = JSON.parse(readTextFileSync(ledgerPath()))
    return Array.isArray(parsed?.entries) ? (parsed.entries as CursorWorkspaceEntry[]) : []
  } catch {
    return []
  }
}

function writeLedger(entries: CursorWorkspaceEntry[]): void {
  attempt(() => {
    const dir = joinPath(registryHome(), 'mcp-runtime')
    mkdirSync(dir, { recursive: true })
    tryChmod(dir, 0o700)
    writeTextFileAtomicSync(ledgerPath(), JSON.stringify({ entries }, null, 2), { mode: 0o600 })
  })
}

function rememberLedger(entry: CursorWorkspaceEntry): void {
  writeLedger([...readLedger().filter((e) => e.jobId !== entry.jobId), entry])
}

function forgetLedger(jobId: string): void {
  writeLedger(readLedger().filter((e) => e.jobId !== jobId))
}

function attempt(fn: () => void): void {
  try {
    fn()
  } catch {
    /* ignore */
  }
}
