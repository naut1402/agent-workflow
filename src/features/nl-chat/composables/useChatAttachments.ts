import { ref } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { uploadChatAttachments } from '../scripts/nlChatApi'
import {
  MAX_ATTACHMENTS_PER_TURN,
  MAX_ATTACHMENT_BYTES,
  isAllowedAttachment,
  type UploadedAttachment,
} from '../schemas/nlChat'

/**
 * The composer's attachment chips: picked/dropped files held client-side until
 * the message is actually sent, then uploaded in one request. Limits are the
 * shared constants from `schemas/nlChat` — rejecting here is for the user's
 * benefit; the route re-checks the same numbers.
 */

export interface ChatAttachmentItem {
  id: string
  file: File
}

// Not `crypto.randomUUID()`: that only exists in a secure context, and the
// dashboard is reachable over plain http on a LAN IP. The id only has to be
// unique among the chips of one draft.
let idSeq = 0
function nextItemId(): string {
  return `att-${Date.now().toString(36)}-${(idSeq += 1)}`
}

export function useChatAttachments(opts: {
  getProjectId: () => string | undefined
  getTaskId?: () => string | undefined
}) {
  const { t } = useI18nHelpers()
  const items = ref<ChatAttachmentItem[]>([])
  const error = ref<string | null>(null)
  const uploading = ref(false)

  function add(files: File[] | null): void {
    error.value = null
    for (const f of files ?? []) {
      if (items.value.length >= MAX_ATTACHMENTS_PER_TURN) {
        error.value = t('nlChat.attachment.tooMany', { max: MAX_ATTACHMENTS_PER_TURN })
        break
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        error.value = t('nlChat.attachment.tooLarge', { name: f.name, max: '10 MB' })
        continue
      }
      if (!isAllowedAttachment(f.name, f.type)) {
        error.value = t('nlChat.attachment.unsupported', { name: f.name })
        continue
      }
      items.value = [...items.value, { id: nextItemId(), file: f }]
    }
  }

  function remove(id: string): void {
    items.value = items.value.filter((i) => i.id !== id)
  }

  function clear(): void {
    items.value = []
    error.value = null
  }

  /** `[]` when there is nothing to send, `null` when the upload failed — the
   *  caller must then keep the text AND the chips so the user can retry. */
  async function upload(): Promise<UploadedAttachment[] | null> {
    if (items.value.length === 0) return []
    uploading.value = true
    try {
      const res = await uploadChatAttachments(
        items.value.map((i) => i.file),
        { projectId: opts.getProjectId(), taskId: opts.getTaskId?.() },
      )
      return res.files
    } catch (e: any) {
      error.value = t('nlChat.attachment.uploadFailed', { error: String(e?.message || e) })
      return null
    } finally {
      uploading.value = false
    }
  }

  return { items, error, uploading, add, remove, clear, upload }
}
