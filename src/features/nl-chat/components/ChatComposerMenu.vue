<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import Icon from '../../../frontend/ui/Icon.vue'
import { useChatSurface } from '../composables/useChatSurface'

defineProps<{ disabled?: boolean; knowledgeDisabled?: boolean }>()
const emit = defineEmits<{ pick: [File[]]; pickKnowledge: [] }>()

const { t } = useI18nHelpers()
const { newBuilderChat } = useChatSurface()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function onAttach(): void {
  open.value = false
  fileInput.value?.click()
}

function onPickKnowledge(): void {
  open.value = false
  emit('pickKnowledge')
}

function onNewSession(): void {
  open.value = false
  newBuilderChat()
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement
  emit('pick', Array.from(input.files ?? []))
  // xem docs/architecture/code/nl-chat.md §7
  input.value = ''
}

function onDocClick(e: MouseEvent): void {
  if (!open.value) return
  if (rootRef.value?.contains(e.target as Node)) return
  open.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !open.value) return
  open.value = false
  triggerRef.value?.focus()
}

onMounted(() => {
  document.addEventListener('click', onDocClick, true)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootRef" class="nl-chat-composer-add">
    <input ref="fileInput" type="file" multiple hidden @change="onFileChange" />
    <!-- xem docs/architecture/code/nl-chat.md §7 -->
    <button
      ref="triggerRef"
      type="button"
      class="icon-btn icon-btn-inline"
      :title="t('nlChat.composer.addMenu')"
      :aria-label="t('nlChat.composer.addMenu')"
      :aria-expanded="open"
      @click.stop="open = !open"
    >
      <Icon name="plus" :size="14" />
    </button>
    <div v-if="open" class="nl-chat-composer-menu">
      <button
        type="button"
        class="nl-chat-composer-menu-item"
        data-testid="composer-menu-attach"
        :disabled="disabled"
        @click="onAttach"
      >
        {{ t('nlChat.attachment.pick') }}
      </button>
      <button
        type="button"
        class="nl-chat-composer-menu-item"
        data-testid="composer-menu-knowledge"
        :disabled="knowledgeDisabled"
        @click="onPickKnowledge"
      >
        {{ t('nlChat.knowledge.pick') }}
      </button>
      <button
        type="button"
        class="nl-chat-composer-menu-item"
        data-testid="composer-menu-new-session"
        @click="onNewSession"
      >
        {{ t('nlChat.window.newSession') }}
      </button>
    </div>
  </div>
</template>
