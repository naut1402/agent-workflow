<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseMarkdown } from '../../../core/lib/markdownLib'
import { useCopyText } from '../../../core/composables/useCopyText'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import Icon from '../../../core/ui/Icon.vue'

/**
 * One chat message, shared by both bodies (builder + task) — the only place in
 * the feature that renders HTML.
 *
 * User turns render markdown too: a step's system prompt arrives as a user turn
 * and used to show as raw text. Long turns are clamped with CSS rather than by
 * slicing the source — slicing mid-fence renders broken markup.
 */

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
const clamped = computed(() => props.clampable === true && !expanded.value)
</script>

<template>
  <div
    class="nl-chat-message md"
    :class="[`nl-chat-message-${role}`, { 'is-pending': pending, 'is-clamped': clamped }]"
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
