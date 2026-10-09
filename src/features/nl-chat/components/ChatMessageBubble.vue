<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseMarkdown } from '../../../frontend/lib/markdownLib'
import { useCopyText } from '../../../frontend/composables/useCopyText'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import Icon from '../../../frontend/ui/Icon.vue'

const props = defineProps<{
  role: 'user' | 'assistant'
  /** Source text — also what the copy button puts on the clipboard. */
  text: string
  /** Optimistic echo of a message still in flight. */
  pending?: boolean
  /** The body decides: only turns long enough to be worth folding. */
  clampable?: boolean
}>()

const { t } = useI18nHelpers()
const { copyFlash, copyText } = useCopyText()

const html = computed(() => parseMarkdown(props.text))
const expanded = ref(false)
// xem docs/architecture/code/nl-chat.md §9
const clamped = computed(() => props.clampable === true && !expanded.value)

function looksLikeMarkdown(text: string): boolean {
  return text
    .split('\n')
    .some((line) => /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|```|\|.*\|)/.test(line))
}
const isMarkdown = computed(() => props.role === 'user' && looksLikeMarkdown(props.text))
</script>

<template>
  <div
    class="nl-chat-message md"
    :class="[
      `nl-chat-message-${role}`,
      { 'is-pending': pending, 'is-clamped': clamped, 'is-markdown': isMarkdown },
    ]"
  >
    <!-- eslint-disable-next-line vue/no-v-html -- same trust level as artifacts, see design §6 -->
    <div class="nl-chat-message-md" v-html="html"></div>
  </div>
  <div class="nl-chat-message-actions">
    <button v-if="clampable" type="button" class="task-chat-more" @click="expanded = !expanded">
      {{ expanded ? t('nlChat.message.collapse') : t('nlChat.message.expand') }}
    </button>
    <button
      type="button"
      class="icon-btn icon-btn-inline"
      :title="t('nlChat.message.copy')"
      :aria-label="t('nlChat.message.copy')"
      @click="copyText(text)"
    >
      <Icon name="copy" :size="13" />
    </button>
    <span v-if="copyFlash" class="nl-chat-copy-flash" aria-live="polite">{{ copyFlash }}</span>
  </div>
</template>
