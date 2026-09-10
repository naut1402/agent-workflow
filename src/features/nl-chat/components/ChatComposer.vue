<script setup lang="ts">
import { ref } from 'vue'
import ChatAttachmentBar from './ChatAttachmentBar.vue'
import ChatComposerMenu from './ChatComposerMenu.vue'
import KnowledgePickerDialog from '../../../core/ui/KnowledgePickerDialog.vue'
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

const showKnowledgePicker = ref(false)

/** The textarea lives here, but `autoGrow` measures it from the composable. */
function bindInput(el: unknown): void {
  c.inputRef.value = (el as HTMLTextAreaElement) ?? null
}

function removeKnowledge(id: string): void {
  c.knowledgeIds.value = c.knowledgeIds.value.filter((k) => k !== id)
}
</script>

<template>
  <!-- `disabled` tracks `uploading` only, not `canAttach`: `canAttach` folds in
       `canSend`, which the server flips off mid-poll, and chips staged just before
       would then be stuck — not sendable, and with ✕ disabled, not removable either. -->
  <ChatAttachmentBar
    :items="c.attachments.items.value"
    :error="c.attachments.error.value"
    :disabled="c.attachments.uploading.value"
    @remove="c.attachments.remove"
  />

  <!-- Knowledge chips: ids only. The paths are resolved at send time, so a chip
       standing here does not pin the content it had when it was picked. -->
  <div v-if="c.knowledgeIds.value.length || c.knowledgeError.value" class="nl-chat-knowledge-bar">
    <span v-for="id in c.knowledgeIds.value" :key="id" class="chip chip-rm" @click="removeKnowledge(id)">
      {{ id }} ✕
    </span>
    <span v-if="c.knowledgeError.value" class="err">⚠ {{ c.knowledgeError.value }}</span>
  </div>

  <form class="nl-chat-input-row" @submit.prevent="c.onSend">
    <!-- The add menu leads the row: "+" sits at the head of the chat box. -->
    <ChatComposerMenu
      :disabled="!c.canAttach.value"
      :knowledge-disabled="!c.canPickKnowledge.value"
      @pick="c.attachments.add"
      @pick-knowledge="showKnowledgePicker = true"
    />
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

  <KnowledgePickerDialog
    v-if="showKnowledgePicker"
    v-model="c.knowledgeIds.value"
    :project-id="c.projectId.value"
    @close="showKnowledgePicker = false"
  />
</template>

<style scoped lang="scss">
.nl-chat-knowledge-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 12px;
}
</style>
