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
  <div v-if="unreadCount > 0" ref="rootRef" class="floating-notification">
    <button
      type="button"
      class="floating-notification-btn"
      :title="t('notifications.bell.title')"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Icon name="bell" :size="18" class="bell-icon" />
      <span class="floating-notification-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
    </button>

    <div v-if="open" class="floating-notification-dropdown">
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

@keyframes notification-float-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  20% {
    transform: scale(1.12);
  }
  40% {
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .floating-notification-btn,
  .floating-notification-btn .bell-icon {
    animation: none;
  }
}

.floating-notification {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 50;
}
.floating-notification-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  animation: notification-float-pulse 1.5s ease-in-out infinite;
}
.floating-notification-btn .bell-icon {
  transform-origin: top center;
  animation: notification-bell-ring 1.5s ease-in-out infinite;
}
.floating-notification-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 8px;
  background: var(--danger);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}
.floating-notification-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 280px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
</style>
