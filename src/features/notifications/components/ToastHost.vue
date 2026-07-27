<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { NotificationEvent } from '../lib/notificationTypes'

defineProps<{ toasts: NotificationEvent[] }>()
const emit = defineEmits<{ dismiss: [id: string]; select: [event: NotificationEvent] }>()

const { t } = useI18n()

function message(event: NotificationEvent) {
  return event.kind === 'qa_ready'
    ? t('notifications.toast.qaReady', { taskId: event.taskId })
    : t('notifications.toast.hitlPending', { taskId: event.taskId })
}
</script>

<template>
  <div v-if="toasts.length" class="toast-host" role="status" aria-live="polite">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast-item"
      :class="toast.kind"
      @click="emit('select', toast)"
    >
      <span class="toast-glyph">{{ toast.kind === 'qa_ready' ? 'Q' : '⏸' }}</span>
      <span class="toast-message">{{ message(toast) }}</span>
      <button
        type="button"
        class="toast-close"
        :title="t('notifications.toast.close')"
        @click.stop="emit('dismiss', toast.id)"
      >✕</button>
    </div>
  </div>
</template>
