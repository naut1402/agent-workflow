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

<style scoped lang="scss">
.notification-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text);
}
.notification-list-mark-all {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.notification-list-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--muted);
}
.notification-list-items {
  list-style: none;
  margin: 0;
  padding: 0;
}
.notification-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}
.notification-list-item:last-child { border-bottom: none; }
.notification-list-item:hover { background: var(--hover-surface); }
.notification-list-item.unread { background: var(--accent-dim); }
.notification-list-item-message {
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
}
.notification-list-item-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}
</style>
