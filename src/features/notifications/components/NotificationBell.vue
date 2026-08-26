<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import type { NotificationEvent } from '../lib/notificationTypes'
import NotificationList from './NotificationList.vue'
import Icon from '../../../core/ui/Icon.vue'

defineProps<{ unreadCount: number; history: NotificationEvent[] }>()
const emit = defineEmits<{ markAllRead: []; select: [event: NotificationEvent] }>()

const { t } = useI18nHelpers()
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
      <Icon name="bell" :size="16" class="bell-icon" />
      <span v-if="unreadCount > 0" class="bell-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
    </button>

    <div v-if="open" class="bell-dropdown">
      <NotificationList :history="history" @mark-all-read="emit('markAllRead')" @select="emit('select', $event)" />
    </div>
  </div>
</template>
