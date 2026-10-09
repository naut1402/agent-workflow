import {
  basename,
  existsSync,
  extname,
  joinPath,
  mkdir,
  randomUUID,
  resolvePathUnder,
  writeFile,
} from '../../../backend/lib/fileHelper.js'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TURN,
  isAllowedAttachment,
  type UploadedAttachment,
} from '../schemas/nlChat.js'

// xem docs/architecture/code/nl-chat.md §3
const CHAT_UPLOAD_DIR = 'uploads/chat'
const TASK_ATTACH_DIR = 'attachments'
// eslint-disable-next-line no-control-regex -- stripping control chars is the point
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g
const TASK_ID_RE = /^[\w-]{1,64}$/
const MAX_NAME_LENGTH = 120
const NAME_SUFFIX_ROOM = 8

export interface IncomingAttachment {
  name: string
  type: string
  size: number
  bytes: Uint8Array
}

/** Success or refusal; narrow with `'error' in result`. */
export type SaveAttachmentsResult =
  | { saved: UploadedAttachment[] }
  | { status: number; error: string }

/** Safe filename: basename only, no control chars, anything odd becomes `_`. */
export function sanitizeAttachmentName(raw: string): string {
  const base = basename(String(raw || '')).replace(CONTROL_CHARS, '')
  const safe = base
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  if (!safe || /^\.+$/.test(safe)) return 'attachment'
  return safe.slice(0, MAX_NAME_LENGTH - NAME_SUFFIX_ROOM)
}

function targetDir(root: string, taskId: string | undefined, uuid: string): string | null {
  if (taskId) {
    if (!TASK_ID_RE.test(taskId)) return null
    const taskDir = resolvePathUnder(joinPath(root, 'tasks'), taskId)
    if (!taskDir || !existsSync(taskDir)) return null
    return resolvePathUnder(taskDir, TASK_ATTACH_DIR, uuid)
  }
  return resolvePathUnder(joinPath(root, CHAT_UPLOAD_DIR), uuid)
}

function uniqueName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let i = 2; ; i += 1) {
    const candidate = `${stem}-${i}${ext}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/**
 * Count / size / type gate on metadata only; returns the refusal or `null`.
 * xem docs/architecture/code/nl-chat.md §3
 */
export function checkAttachmentLimits(
  files: { name: string; type: string; size: number }[],
): { status: number; error: string } | null {
  if (files.length === 0) return { status: 400, error: 'no file' }
  if (files.length > MAX_ATTACHMENTS_PER_TURN) {
    return { status: 400, error: 'too many files' }
  }
  for (const f of files) {
    if (f.size > MAX_ATTACHMENT_BYTES) {
      return { status: 413, error: `file too large: ${f.name}` }
    }
    if (!isAllowedAttachment(f.name, f.type)) {
      return { status: 415, error: `unsupported type: ${f.name}` }
    }
  }
  return null
}

export async function saveChatAttachments(
  root: string,
  files: IncomingAttachment[],
  opts: { taskId?: string } = {},
): Promise<SaveAttachmentsResult> {
  const refusal = checkAttachmentLimits(files)
  if (refusal) return refusal

  const uuid = randomUUID()
  const dir = targetDir(root, opts.taskId, uuid)
  if (!dir) return { status: 400, error: 'invalid target' }
  await mkdir(dir, { recursive: true })

  const used = new Set<string>()
  const saved: UploadedAttachment[] = []
  for (const f of files) {
    const safeName = uniqueName(used, sanitizeAttachmentName(f.name))
    const dest = resolvePathUnder(dir, safeName)
    if (!dest) return { status: 400, error: `invalid filename: ${f.name}` }
    await writeFile(dest, Buffer.from(f.bytes))
    saved.push({ name: safeName, path: dest, size: f.size, type: f.type })
  }
  return { saved }
}
