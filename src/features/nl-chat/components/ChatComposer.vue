<script setup lang="ts">
import ChatAttachmentBar from './ChatAttachmentBar.vue'
import ChatComposerMenu from './ChatComposerMenu.vue'
import type { UseChatComposer } from '../composables/useChatComposer'

/**
 * Attachment chips + the input row. Once `useChatComposer` owns the behaviour,
 * this markup is identical in both chat bodies apart from the placeholder, so it
 * lives here instead of twice.
 *
 * It takes the composer object whole rather than a dozen separate props: the
 * object's identity is stable for the lifetime of the body that owns it, and
 * adding a field to the composable then does not mean threading one more prop
 * through both call sites. Fields are refs, so the template reads `.value` — the
 * same way `TaskChatBody` already reads its `useTaskChat` object.
 */
const props = defineProps<{ composer: UseChatComposer; placeholder: string }>()
const c = props.composer

/** The textarea lives here, but `autoGrow` measures it from the composable. */
function bindInput(el: unknown): void {
  c.inputRef.value = (el as HTMLTextAreaElement) ?? null
}
</script>

<template>
  <ChatAttachmentBar
    :items="c.attachments.items.value"
    :error="c.attachments.error.value"
    @remove="c.attachments.remove"
  />

  <form class="nl-chat-input-row" @submit.prevent="c.onSend">
    <!-- The add menu leads the row: "+" sits at the head of the chat box. -->
    <ChatComposerMenu :disabled="!c.canAttach.value" @pick="c.attachments.add" />
    <textarea
      :ref="bindInput"
      v-model="c.inputText.value"
      rows="2"
      :placeholder="placeholder"
      :title="c.composerHint.value"
      :disabled="!c.canAttach.value"
      @input="c.autoGrow"
      @keydown.enter.exact="c.onEnterKey"
      @keydown.ctrl.enter.prevent="c.onSend"
      @keydown.meta.enter.prevent="c.onSend"
    ></textarea>
    <button type="submit" :disabled="!c.canSubmit.value">Gửi</button>
  </form>
</template>
