// Giao cấu hình MCP cho `cursor-agent`: nó KHÔNG có cờ kiểu `--mcp-config`, chỉ
// đọc `<cwd>/.cursor/mcp.json`. Tức là file secret phải nằm TRONG workspace của
// người dùng trong suốt vòng đời job — ngược hẳn với nhánh claude, nơi file nằm
// an toàn dưới `registryHome()`.
//
// Bốn hệ quả, cả bốn đều được xử lý ở đây chứ không để caller tự nhớ:
//  1. File sẵn có của người dùng phải được trả lại NGUYÊN TRẠNG ⇒ sao lưu → ghi
//     → khôi phục trong `finally`. 🚫 Không hợp nhất nội dung: sửa file của người
//     dùng mà không truy ngược được là thứ không bao giờ chấp nhận.
//  2. `.cursor/` KHÔNG nằm trong `.gitignore` của project đích ⇒ file chứa secret
//     đã giải lọt `git status` của chính agent. Tự ghi `.cursor/.gitignore`.
//  3. Dashboard bị `kill -9` giữa job ⇒ `dispose()` không chạy, secret nằm lại
//     trong repo người dùng. Ledger + dọn lúc bootstrap là lưới cuối.
//  4. HAI JOB CÙNG WORKSPACE. `jobQueue.ts` cho task khác nhau chạy SONG SONG và
//     `job.workspace` là đường dẫn project, nên hai task của cùng một project
//     dùng chung đúng một thư mục `.cursor/`. Không khoá thì interleaving
//     A-start → B-start → A-dispose → B-dispose XOÁ MẤT file gốc của người dùng
//     và bỏ lại một file secret plaintext mà ledger đã rỗng không dọn nổi.
//     Xem `acquireWorkspaceLock`.

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
import { sanitiseMcpServerId } from '../../../mcp/business/index.js'
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

/**
 * Lượt ghi đã đi tới đâu. Tách thành field TƯỜNG MINH thay vì suy ra từ
 * `sha256 === ''`: từ khi `restoreWorkspace` rẽ nhánh theo nó, đây là công tắc
 * điều khiển chứ không còn là dữ liệu — mà `readLedger` thì `JSON.parse` + ép
 * kiểu, nên một ledger hỏng tay/thiếu field sẽ âm thầm chọn nhánh.
 *
 * Mặc định khi giá trị lạ/thiếu là `'written'` (xem `restoreWorkspace`): chọn
 * nhánh THẬN TRỌNG — thử xoá có kiểm hash — thay vì nhánh bỏ qua.
 */
type CursorWorkspaceStage =
  /** Đã giành khoá, CHƯA chạm file nào. */
  | 'locked'
  /** Đã (định) ghi file cấu hình — `sha256` có nghĩa. */
  | 'written'

/** Một lượt ghi đang mở — đủ thông tin để hoàn tác mà không cần job còn sống. */
interface CursorWorkspaceEntry {
  jobId: string
  stage: CursorWorkspaceStage
  dir: string
  path: string
  lock: string
  /** Đường dẫn bản sao lưu file sẵn có của người dùng, `null` khi không có file nào. */
  backup: string | null
  /** `.cursor/` đã tồn tại TRƯỚC lượt này ⇒ 🚫 không xoá thư mục, 🚫 không đụng quyền. */
  dirExisted: boolean
  /** Chính lượt này tạo ra `.cursor/.gitignore` ⇒ xoá nó lúc dọn; của người dùng thì giữ. */
  gitignoreCreated: boolean
  /**
   * SHA-256 của nội dung CHÍNH TA ghi ra. 🚫 Không lưu nội dung: nó chứa secret
   * đã giải, mà ledger nằm ở registry home dạng thô.
   *
   * Dùng để trả lời đúng một câu trước khi `rm`: "file đang nằm đây có còn là
   * file của ta không?". Nếu không — người dùng đã ghi đè, hoặc một lượt khác đã
   * chen vào — thì 🚫 KHÔNG xoá. Xoá nhầm là mất dữ liệu của người khác.
   *
   * `''` ở bản ghi `stage: 'locked'` — chưa chạm file nào. Chuỗi rỗng 🚫 không
   * khớp hash của file nào nên `isOurConfig` luôn `false`.
   */
  sha256: string
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

/**
 * Khoá theo workspace bằng `mkdir` KHÔNG `recursive` — lời gọi này là nguyên tử
 * ở tầng syscall và ném `EEXIST` khi thư mục đã có, nên nó vừa là phép thử vừa
 * là phép chiếm, không có khe hở giữa "kiểm tra" và "giành".
 *
 * 📌 Chọn lockfile thay vì `Map` trong module vì hai lý do: `Map` chỉ chặn được
 * trong MỘT tiến trình (hai dashboard cùng máy, cùng project vẫn giẫm nhau), và
 * `Map` biến mất khi tiến trình chết nên không giúp gì cho đường dọn mồ côi.
 *
 * Trả `false` ⇒ caller 🚫 KHÔNG ghi gì cả và trả `null`: job chạy không có MCP.
 * Đó là lựa chọn có chủ ý — mất tool là phiền, còn ghi đè `.cursor/mcp.json` của
 * một job đang chạy là hỏng dữ liệu của người dùng.
 */
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
  // Bất biến argv: không `ids` VÀ không `extras` ⇒ không file nào chạm đĩa.
  if (!resolved) return null

  const jobKey = sanitiseMcpServerId(input.jobId) ?? 'unknown'
  const dir = joinPath(input.workspace, CURSOR_DIR)
  const path = joinPath(dir, CURSOR_CONFIG)
  const gitignorePath = joinPath(dir, CURSOR_GITIGNORE)
  const lock = joinPath(dir, CURSOR_LOCK)

  // Chụp TRƯỚC khi `mkdir`: sau đó thì thư mục luôn tồn tại và không còn phân
  // biệt được "của người dùng" với "của ta".
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
    // Thư mục ta vừa tạo mà không chiếm được khoá thì trả lại hiện trạng —
    // nhưng chỉ khi nó rỗng, vì lượt đang giữ khoá có file nằm trong đó.
    if (!dirExisted) tryRemoveEmptyDir(dir)
    input.onWarning?.(
      `mcp: ${dir} đang được một job khác dùng — job này chạy KHÔNG có MCP server `
      + '(🚫 không ghi đè cấu hình của lượt đang chạy)',
    )
    return null
  }

  // 📌 Dấu vết phải có NGAY, trước cả lần `existsSync` đầu tiên: từ giây giành
  // được khoá, thư mục khoá đã nằm trên đĩa. Chết trong khoảng giữa "giành khoá"
  // và "ghi ledger đầy đủ" mà 🚫 không có entry nào trỏ tới thì
  // `cleanupOrphanedCursorMcpWorkspaces()` — vốn chỉ duyệt ledger — 🚫 không
  // thấy gì để gỡ, và workspace đó chạy cursor KHÔNG MCP vĩnh viễn với một dòng
  // warning "đang được job khác dùng" trong khi 🚫 không job nào chạy.
  //
  // Cửa sổ hẹp (vài lời gọi đồng bộ) nhưng hậu quả vĩnh viễn và im lặng, nên trả
  // bằng một lần ghi ledger thừa là xứng đáng. Lần ghi đầy đủ bên dưới ghi đè
  // bản tạm này — `rememberLedger` lọc theo `jobId`.
  rememberLedger(lockedEntry({}))

  // Quyền chỉ đụng vào thư mục CHÍNH TA tạo. `.cursor/` sẵn có của người dùng
  // thường là 0755 và `restoreWorkspace` không khôi phục mode được, nên hạ nó
  // xuống 0700 là một tác dụng phụ vĩnh viễn — đúng thứ chuỗi i18n
  // `mcpWorkspaceFile` đang hứa là KHÔNG xảy ra. Rào thật là 0600 trên `mcp.json`.
  if (!dirExisted) tryChmod(dir, 0o700)

  const content = JSON.stringify(resolved.json, null, 2)
  const backup = existsSync(path) ? `${path}.dashboard-backup-${jobKey}` : null
  const entry = lockedEntry({
    stage: 'written',
    backup,
    gitignoreCreated: !existsSync(gitignorePath),
    sha256: sha256(content),
  })

  // Nâng bản tạm thành bản đầy đủ, vẫn TRƯỚC khi chạm file: mọi field đều tính
  // được mà không cần ghi gì, nên `kill -9` ở BẤT KỲ điểm nào bên dưới cũng để
  // lại dấu vết dọn được. Ghi sau là có một cửa sổ mà file secret đã nằm trong
  // repo người dùng còn ledger thì chưa biết gì về nó.
  rememberLedger(entry)

  try {
    if (backup) renameSync(path, backup)
    writeTextFileSync(path, content, { mode: 0o600 })
    tryChmod(path, 0o600)
    if (entry.gitignoreCreated) writeTextFileSync(gitignorePath, '*\n')
  } catch (err) {
    // Ghi hụt giữa chừng ⇒ hoàn tác ngay, 🚫 không để lại nửa vời rồi mới ném.
    // Dọn hụt ⇒ GIỮ entry cho đường bootstrap thử tiếp (xem `dispose`).
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
      // 📌 Chỉ quên entry khi đã dọn SẠCH. Dọn hụt mà vẫn `forgetLedger` là tự
      // tay vứt lưới cuối đúng lúc cần nó nhất — `cleanupOrphanedCursorMcpWorkspaces()`
      // sẽ 🚫 không còn gì để dọn. Giữ entry an toàn: `restoreWorkspace`
      // idempotent và `isOurConfig` tự chặn xoá nhầm.
      if (restoreWorkspace(entry)) forgetLedger(entry.jobId)
    },
  }
}

/**
 * Hoàn tác đúng thứ tự ĐẢO NGƯỢC lúc ghi. Mỗi bước bọc riêng: dọn hụt một bước
 * không được chặn các bước sau, và 🚫 không bao giờ được làm hỏng kết quả job.
 *
 * Idempotent — `dispose()` và đường dọn mồ côi có thể cùng chạy trên một entry.
 *
 * Trả về **"workspace đã sạch bóng cấu hình của ta chưa"**, và ba bước dưới rẽ
 * theo đúng một kết quả đó. Rẽ lệch nhau là lớp lỗi thật: bản trước giữ được
 * `isOurConfig` (🚫 không xoá file người khác) nhưng vẫn gỡ `.gitignore` và vẫn
 * `forgetLedger` VÔ ĐIỀU KIỆN ⇒ ca "file bị ghi đè giữa job" để lại secret
 * plaintext TRONG repo, lại còn vừa cởi lớp che git vừa vứt lưới dọn cuối.
 */
function restoreWorkspace(entry: CursorWorkspaceEntry): boolean {
  // Chỉ `'locked'` mới được bỏ qua bước xoá — nghĩa là chưa chạm file nào, chỉ
  // cần nhả khoá (và 🚫 không được tính là "dọn hụt", nếu không thì bản ghi tạm
  // ở lại ledger mãi và đẻ cảnh báo giả mỗi lần bootstrap).
  //
  // 📌 So `!== 'locked'` chứ 🚫 không `=== 'written'`: entry thiếu field / sai
  // giá trị (ledger sửa tay, bản ghi của build cũ) rơi về nhánh THẬN TRỌNG —
  // thử xoá có kiểm hash. Hash lệch thì `clean = false` ⇒ giữ entry + cảnh báo,
  // 🚫 không bao giờ âm thầm bỏ qua một file secret.
  const wroteConfig = entry.stage !== 'locked'
  let clean = true

  if (wroteConfig) {
    clean = false
    attempt(() => {
      // 📌 Chỉ xoá khi file đang nằm đó ĐÚNG là file ta ghi. Khoá theo workspace
      // đã chặn job khác, nhưng 🚫 không chặn được tiến trình ngoài:
      // `.cursor/mcp.json` là file cấu hình MCP của chính Cursor IDE, người dùng
      // mở bảng MCP settings trong lúc job chạy là đủ để nó bị ghi lại.
      //
      // 🚫 Không còn file nào ⇒ cũng là sạch: không có gì của ta để che nữa.
      if (!existsSync(entry.path) || isOurConfig(entry)) {
        rmSync(entry.path, { force: true })
        clean = true
      }
    })
  }

  // 📌 Chỉ gỡ `.gitignore` khi file secret ĐÃ đi. Còn file thì còn phải che nó
  // khỏi git — đó đúng là việc file này sinh ra để làm, và ca duy nhất nó còn
  // cần thiết lại chính là ca ta 🚫 không xoá được file.
  if (entry.gitignoreCreated && clean) {
    attempt(() => rmSync(joinPath(entry.dir, CURSOR_GITIGNORE), { force: true }))
  }
  // 🚫 Không ghi đè: nếu `path` vẫn còn (vì không phải file của ta) thì bản sao
  // lưu ở lại cạnh nó, ai đó nhìn thấy còn truy được; đè lên là mất cả hai.
  if (entry.backup) {
    attempt(() => {
      if (existsSync(entry.backup as string) && !existsSync(entry.path)) {
        renameSync(entry.backup as string, entry.path)
      }
    })
  }
  // Nhả khoá VÔ ĐIỀU KIỆN và SAU cùng: trước khi nhả thì 🚫 không job nào khác
  // vào được đây, còn không nhả thì workspace kẹt vĩnh viễn — kẹt khoá hỏng nặng
  // hơn mọi thứ các bước trên đang cố cứu.
  attempt(() => rmSync(entry.lock, { recursive: true, force: true }))
  // Chỉ xoá thư mục khi CHÍNH lượt này tạo ra nó VÀ nó đang rỗng — người dùng có
  // thể có `.cursor/rules/` hay cấu hình khác nằm cạnh.
  if (!entry.dirExisted) attempt(() => tryRemoveEmptyDir(entry.dir))

  if (!clean) {
    // Im lặng 🚫 không chấp nhận được ở đây: còn một file secret đã giải nằm
    // trong repo người dùng mà ta không có quyền xoá. Nêu đủ hai đường đi tiếp.
    console.warn(
      `[dev-team-dashboard] ${entry.path} đã bị sửa bởi tiến trình khác trong lúc job `
      + `${entry.jobId} chạy — 🚫 KHÔNG xoá để khỏi mất dữ liệu của bạn, nhưng file này `
      + 'CÓ THỂ còn chứa secret đã giải. Hãy kiểm tra rồi xoá tay.'
      + (entry.backup ? ` Bản gốc của bạn đang ở ${entry.backup}.` : ''),
    )
  }
  return clean
}

/** File ở `path` có đúng là bản ta ghi không — so bằng hash, 🚫 không lưu nội dung. */
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
 * Dọn lượt ghi mồ côi lúc bootstrap: `dispose()` chỉ chạy trong `finally` của
 * job, nên tiến trình bị `kill -9` để lại file secret plaintext TRONG repo người
 * dùng — kèm cả bản sao lưu file gốc của họ, và một khoá không ai nhả.
 *
 * 📌 Đây cũng là đường DUY NHẤT gỡ khoá treo: không có nó thì một lần `kill -9`
 * là workspace đó vĩnh viễn chạy cursor không MCP. Chạy cạnh
 * `cleanupOrphanedMcpConfigs()`, trước khi job đầu tiên của tiến trình mới vào hàng.
 */
export function cleanupOrphanedCursorMcpWorkspaces(): void {
  const entries = readLedger()
  if (!entries.length) return
  // 📌 GIỮ lại entry nào chưa dọn sạch, 🚫 không `writeLedger([])` vô điều kiện:
  // xoá sạch là vứt đúng cái lưới này ở ca duy nhất nó còn việc để làm. Entry ở
  // lại thì lần bootstrap sau thử tiếp — `restoreWorkspace` idempotent nên chạy
  // lại 🚫 không hại gì, và `isOurConfig` vẫn chặn xoá nhầm.
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
    /* dọn hụt không được làm hỏng kết quả job, cũng không được chặn bootstrap */
  }
}
