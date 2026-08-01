<script setup lang="ts">
import { ref } from 'vue'
import { useApp } from '../../../plugins'
import { onClickOutside } from '@vueuse/core'
import type { NotificationEvent } from '../lib/notificationTypes'
import NotificationList from './NotificationList.vue'

defineProps<{ unreadCount: number; history: NotificationEvent[] }>()
const emit = defineEmits<{ markAllRead: []; select: [event: NotificationEvent] }>()

const app = useApp()
const t = (...args: any[]) => app.$t(...args) as string
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

onClickOutside(rootRef, () => {
  open.value = false
})
</script>

<template>
  <div ref="rootRef" class="notification-bell">
    <button
      type="button"
      class="mode-btn rail-icon-btn bell-btn"
      :class="{ 'has-unread': unreadCount > 0 }"
      :title="t('notifications.bell.title')"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg class="bell-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8 2.5c-2 0-3.2 1.5-3.2 3.6v1.8L3.5 10.6h9l-1.3-2.7V6.1C11.2 4 10 2.5 8 2.5z" />
        <path d="M6.7 12.2a1.3 1.3 0 0 0 2.6 0" />
      </svg>
      <span v-if="unreadCount > 0" class="bell-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
    </button>

    <div v-if="open" class="bell-dropdown">
      <NotificationList :history="history" @mark-all-read="emit('markAllRead')" @select="emit('select', $event)" />
    </div>
  </div>
</template>
