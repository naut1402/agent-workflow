<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'
import type { NotificationEvent } from '../lib/notificationTypes'

defineProps<{ unreadCount: number; history: NotificationEvent[] }>()
const emit = defineEmits<{ markAllRead: []; select: [event: NotificationEvent] }>()

const { t } = useI18n()
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

onClickOutside(rootRef, () => {
  open.value = false
})

function message(event: NotificationEvent) {
  return event.kind === 'qa_ready'
    ? t('notifications.toast.qaReady', { taskId: event.taskId })
    : t('notifications.toast.hitlPending', { taskId: event.taskId })
}
</script>

<template>
  <div ref="rootRef" class="notification-bell">
    <button
      type="button"
      class="mode-btn rail-icon-btn bell-btn"
      :title="t('notifications.bell.title')"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8 2.5c-2 0-3.2 1.5-3.2 3.6v1.8L3.5 10.6h9l-1.3-2.7V6.1C11.2 4 10 2.5 8 2.5z" />
        <path d="M6.7 12.2a1.3 1.3 0 0 0 2.6 0" />
      </svg>
      <span v-if="unreadCount > 0" class="bell-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
    </button>

    <div v-if="open" class="bell-dropdown">
      <header class="bell-dropdown-header">
        <span>{{ t('notifications.bell.title') }}</span>
        <button v-if="history.length" type="button" class="bell-mark-all" @click="emit('markAllRead')">
          {{ t('notifications.bell.markAllRead') }}
        </button>
      </header>
      <p v-if="!history.length" class="bell-empty">{{ t('notifications.bell.empty') }}</p>
      <ul v-else class="bell-list">
        <li
          v-for="event in history"
          :key="event.id"
          class="bell-item"
          :class="{ unread: !event.read }"
          @click="emit('select', event)"
        >
          <span class="flag" :class="event.kind === 'qa_ready' ? 'qa' : 'hitl'">
            {{ event.kind === 'qa_ready' ? 'Q' : '⏸' }}
          </span>
          <span class="bell-item-message">{{ message(event) }}</span>
          <span v-if="!event.read" class="bell-item-dot" :title="t('notifications.flag.unread')"></span>
        </li>
      </ul>
    </div>
  </div>
</template>
