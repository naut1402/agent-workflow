<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import Icon from '../../../core/ui/Icon.vue'
import { useChatSurface } from '../composables/useChatSurface'

/**
 * The "+" at the head of the input row: it gathers the actions that used to be
 * scattered around the window — attaching files (the paperclip that sat in the
 * attachment strip) and starting a new session (the "+" that sat in the header).
 *
 * Shape follows the Statistics panel's add-card button; the dismissal follows
 * `QuickActionMenuDropdown`, because the Statistics one has none.
 */
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ pick: [File[]] }>()

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

/**
 * A new session is pushed on top; the current one is left alone (in task mode
 * tearing it down would close the step's CLI session). Close first — the new
 * session swaps the body underneath, and a menu left open would be orphaned.
 */
function onNewSession(): void {
  open.value = false
  newBuilderChat()
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement
  emit('pick', Array.from(input.files ?? []))
  // Reset so picking the same file twice in a row still fires `change`.
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
    <!-- `type="button"` on all three: they live inside the composer's <form>, so
         the default `submit` would send the message on every click. -->
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
    <!-- Plain buttons, no `role="menu"`/`menuitem`: that pair is an ARIA
         contract for arrow-key roving focus, which this list does not implement.
         `QuickActionMenuDropdown` — the dropdown this one follows — omits them
         for the same reason. Tab and Escape are the keyboard story here. -->
    <div v-if="open" class="nl-chat-composer-menu">
      <!-- Only attaching is gated: a new session must stay reachable when the
           flow has finished or the step has no CLI session to send into. -->
      <button
        type="button"
        class="nl-chat-composer-menu-item"
        :disabled="disabled"
        @click="onAttach"
      >
        {{ t('nlChat.attachment.pick') }}
      </button>
      <button type="button" class="nl-chat-composer-menu-item" @click="onNewSession">
        {{ t('nlChat.window.newSession') }}
      </button>
    </div>
  </div>
</template>
