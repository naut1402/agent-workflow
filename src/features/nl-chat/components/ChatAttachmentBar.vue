<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import Icon from '../../../core/ui/Icon.vue'
import type { ChatAttachmentItem } from '../composables/useChatAttachments'

/**
 * Composer strip: the paperclip picker plus one chip per staged file. Files are
 * only uploaded when the message is sent, so chips are removable until then.
 */

const props = defineProps<{
  items: ChatAttachmentItem[]
  error?: string | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  pick: [File[]]
  remove: [string]
}>()

const { t } = useI18nHelpers()
const fileInput = ref<HTMLInputElement | null>(null)

/** Object URLs must be revoked or the browser keeps every previewed file alive. */
const previews = new Map<string, string>()

function previewUrl(item: ChatAttachmentItem): string | null {
  if (!item.file.type.startsWith('image/')) return null
  let url = previews.get(item.id)
  if (!url) {
    url = URL.createObjectURL(item.file)
    previews.set(item.id, url)
  }
  return url
}

function releasePreview(id: string): void {
  const url = previews.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    previews.delete(id)
  }
}

function onRemove(id: string): void {
  releasePreview(id)
  emit('remove', id)
}

// Sync on the list itself, not on the remove event: sending a message clears all
// chips at once (`attachments.clear()`) without going through `onRemove`, and the
// body now lives as long as its session, so those blobs would never be released.
watch(
  () => props.items,
  (list) => {
    const live = new Set(list.map((i) => i.id))
    for (const id of [...previews.keys()]) if (!live.has(id)) releasePreview(id)
  },
  { deep: true },
)

function onPickClick(): void {
  fileInput.value?.click()
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement
  emit('pick', Array.from(input.files ?? []))
  // Reset so picking the same file twice in a row still fires `change`.
  input.value = ''
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

onUnmounted(() => {
  for (const url of previews.values()) URL.revokeObjectURL(url)
  previews.clear()
})
</script>

<template>
  <div class="nl-chat-attach">
    <input ref="fileInput" type="file" multiple hidden @change="onFileChange" />
    <button
      type="button"
      class="icon-btn icon-btn-inline"
      :disabled="disabled"
      :title="t('nlChat.attachment.pick')"
      :aria-label="t('nlChat.attachment.pick')"
      @click="onPickClick"
    >
      <Icon name="paperclip" :size="14" />
    </button>
    <ul v-if="items.length" class="nl-chat-chips">
      <li v-for="item in items" :key="item.id" class="nl-chat-chip">
        <img v-if="previewUrl(item)" class="nl-chat-chip-thumb" :src="previewUrl(item)!" alt="" />
        <span class="nl-chat-chip-name" :title="item.file.name">{{ item.file.name }}</span>
        <span class="nl-chat-chip-size">{{ formatSize(item.file.size) }}</span>
        <button
          type="button"
          class="icon-btn icon-btn-inline"
          :title="t('nlChat.attachment.remove')"
          :aria-label="t('nlChat.attachment.remove')"
          @click="onRemove(item.id)"
        >
          <Icon name="close" :size="11" />
        </button>
      </li>
    </ul>
    <p v-if="error" class="nl-chat-error nl-chat-attach-error">{{ error }}</p>
  </div>
</template>
