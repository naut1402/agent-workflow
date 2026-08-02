<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import type { NotificationEvent } from '../lib/notificationTypes'

defineProps<{ history: NotificationEvent[] }>()
const emit = defineEmits<{ markAllRead: []; select: [event: NotificationEvent] }>()

const { t } = useI18nHelpers()

function message(event: NotificationEvent) {
  return event.kind === 'qa_ready'
    ? t('notifications.message.qaReady', { taskId: event.taskId })
    : t('notifications.message.hitlPending', { taskId: event.taskId })
}
</script>

<template>
  <div class="notification-list">
    <header class="notification-list-header">
      <span>{{ t('notifications.bell.title') }}</span>
      <button v-if="history.length" type="button" class="notification-list-mark-all" @click="emit('markAllRead')">
        {{ t('notifications.bell.markAllRead') }}
      </button>
    </header>
    <p v-if="!history.length" class="notification-list-empty">{{ t('notifications.bell.empty') }}</p>
    <ul v-else class="notification-list-items">
      <li
        v-for="event in history"
        :key="event.id"
        class="notification-list-item"
        :class="{ unread: !event.read }"
        @click="emit('select', event)"
      >
        <span class="flag" :class="event.kind === 'qa_ready' ? 'qa' : 'hitl'">
          {{ event.kind === 'qa_ready' ? 'Q' : '⏸' }}
        </span>
        <span class="notification-list-item-message">{{ message(event) }}</span>
        <span v-if="!event.read" class="notification-list-item-dot" :title="t('notifications.flag.unread')"></span>
      </li>
    </ul>
  </div>
</template>
