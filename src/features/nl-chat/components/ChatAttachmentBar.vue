<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import Icon from '../../../frontend/ui/Icon.vue'
import type { ChatAttachmentItem } from '../composables/useChatAttachments'

const props = defineProps<{
  items: ChatAttachmentItem[]
  error?: string | null
  /**
   * True only while an upload is in flight.
   * xem docs/architecture/code/nl-chat.md §4
   */
  disabled?: boolean
}>()
const emit = defineEmits<{
  remove: [string]
}>()

const { t } = useI18nHelpers()

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
  if (props.disabled) return
  releasePreview(id)
  emit('remove', id)
}

// xem docs/architecture/code/nl-chat.md §4
watch(
  () => props.items,
  (list) => {
    const live = new Set(list.map((i) => i.id))
    for (const id of [...previews.keys()]) if (!live.has(id)) releasePreview(id)
  },
  { deep: true },
)

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
  <div v-if="items.length || error" class="nl-chat-attach">
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
          :disabled="disabled"
          @click="onRemove(item.id)"
        >
          <Icon name="close" :size="11" />
        </button>
      </li>
    </ul>
    <p v-if="error" class="nl-chat-error nl-chat-attach-error">{{ error }}</p>
  </div>
</template>
