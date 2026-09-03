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

<style scoped lang="scss">
@keyframes notification-bell-ring {
  0%,
  100% {
    transform: rotate(0deg) scale(1);
  }
  8% {
    transform: rotate(14deg) scale(1.18);
  }
  16% {
    transform: rotate(-12deg) scale(1.22);
  }
  24% {
    transform: rotate(10deg) scale(1.16);
  }
  32% {
    transform: rotate(-8deg) scale(1.12);
  }
  40% {
    transform: rotate(4deg) scale(1.06);
  }
  48%,
  100% {
    transform: rotate(0deg) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bell-btn.has-unread .bell-icon {
    animation: none;
  }
}

.notification-bell {
  position: relative;
}
.bell-btn {
  position: relative;
}
.bell-btn.has-unread .bell-icon {
  transform-origin: top center;
  animation: notification-bell-ring 1.5s ease-in-out infinite;
}
.bell-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--danger);
  color: #fff;
  font-size: 9px;
  line-height: 14px;
  text-align: center;
}
.bell-dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 280px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  z-index: 20;
}
</style>
