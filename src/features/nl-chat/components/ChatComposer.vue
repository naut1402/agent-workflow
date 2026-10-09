<script setup lang="ts">
import { ref } from 'vue'
import ChatAttachmentBar from './ChatAttachmentBar.vue'
import ChatComposerMenu from './ChatComposerMenu.vue'
import KnowledgePickerDialog from '../../../frontend/ui/KnowledgePickerDialog.vue'
import Icon from '../../../frontend/ui/Icon.vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import type { UseChatComposer } from '../composables/useChatComposer'

const props = defineProps<{ composer: UseChatComposer; placeholder: string }>()
const c = props.composer

const { t } = useI18nHelpers()
const showKnowledgePicker = ref(false)

function bindInput(el: unknown): void {
  c.inputRef.value = (el as HTMLTextAreaElement) ?? null
}

function removeKnowledge(id: string): void {
  c.knowledgeIds.value = c.knowledgeIds.value.filter((k) => k !== id)
}
</script>

<template>
  <!-- xem docs/architecture/code/nl-chat.md §4 -->
  <ChatAttachmentBar
    :items="c.attachments.items.value"
    :error="c.attachments.error.value"
    :disabled="c.attachments.uploading.value"
    @remove="c.attachments.remove"
  />

  <div v-if="c.knowledgeIds.value.length || c.knowledgeError.value" class="nl-chat-knowledge-bar">
    <span v-for="id in c.knowledgeIds.value" :key="id" class="chip chip-rm" @click="removeKnowledge(id)">
      {{ id }} ✕
    </span>
    <span v-if="c.knowledgeError.value" class="err">⚠ {{ c.knowledgeError.value }}</span>
  </div>

  <form class="nl-chat-input-row" @submit.prevent="c.onSend">
    <ChatComposerMenu
      :disabled="!c.canAttach.value"
      :knowledge-disabled="!c.canPickKnowledge.value"
      @pick="c.attachments.add"
      @pick-knowledge="showKnowledgePicker = true"
    />
    <textarea
      :ref="bindInput"
      v-model="c.inputText.value"
      rows="1"
      :placeholder="placeholder"
      :title="c.composerHint.value"
      :disabled="!c.canAttach.value"
      @input="c.autoGrow"
      @keydown.enter.exact="c.onEnterKey"
      @keydown.ctrl.enter.prevent="c.onSend"
      @keydown.meta.enter.prevent="c.onSend"
    ></textarea>
    <button
      type="submit"
      class="icon-btn icon-btn-inline nl-chat-send"
      :disabled="!c.canSubmit.value"
      :title="t('nlChat.composer.send')"
      :aria-label="t('nlChat.composer.send')"
    >
      <Icon name="send" :size="14" />
    </button>
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
