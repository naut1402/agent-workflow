<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import type { TaskGroup } from '../lib/groupRunningJobs'
import RunningJobsList from './RunningJobsList.vue'

defineProps<{
  runningCount: number
  groups: TaskGroup[]
  truncated: boolean
  hiddenTaskCount: number
}>()
const emit = defineEmits<{ select: [taskId: string] }>()

const { t } = useI18nHelpers()
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
let leaveTimer: ReturnType<typeof setTimeout> | null = null

onClickOutside(rootRef, () => {
  open.value = false
})

function onSelect(taskId: string) {
  open.value = false
  emit('select', taskId)
}

function clearLeaveTimer() {
  if (leaveTimer) {
    clearTimeout(leaveTimer)
    leaveTimer = null
  }
}

// Hover stays as a mouse convenience; the trigger button below is the
// keyboard/click path (`aria-expanded` + toggle) so a mouse-less user can
// open the dropdown and reach the running-job list at all.
function onEnter() {
  clearLeaveTimer()
  open.value = true
}

function onLeave() {
  clearLeaveTimer()
  leaveTimer = setTimeout(() => {
    open.value = false
    leaveTimer = null
  }, 150)
}

function onTriggerClick() {
  open.value = !open.value
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    open.value = false
    triggerRef.value?.focus()
  }
}

onUnmounted(() => {
  clearLeaveTimer()
})
</script>

<template>
  <div
    v-if="runningCount > 0"
    ref="rootRef"
    class="floating-running-jobs"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @keydown="onKeydown"
  >
    <button
      ref="triggerRef"
      type="button"
      class="floating-running-jobs-btn"
      :title="t('runningJobs.icon.title')"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="onTriggerClick"
    >
      <svg
        class="activity-icon"
        width="18"
        height="18"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <polyline points="2.5 9.5 5.5 6.5 8 9 13.5 3.5" />
        <polyline points="10.5 3.5 13.5 3.5 13.5 6.5" />
      </svg>
      <span class="floating-running-jobs-badge">{{ runningCount > 9 ? '9+' : runningCount }}</span>
    </button>

    <div v-if="open" class="floating-running-jobs-dropdown">
      <RunningJobsList
        :groups="groups"
        :truncated="truncated"
        :hidden-task-count="hiddenTaskCount"
        @select="onSelect"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.floating-running-jobs {
  position: fixed;
  top: 16px;
  right: 60px; /* 16 + 36 + 8 — left of notification */
  z-index: 50;
}
.floating-running-jobs-btn {
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
  animation: running-jobs-float-pulse 1.5s ease-in-out infinite;
}
.floating-running-jobs-btn .activity-icon {
  transform-origin: center;
}
.floating-running-jobs-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}
.floating-running-jobs-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 300px;
  max-height: 360px;
  overflow-y: auto;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}

@keyframes running-jobs-float-pulse {
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
  .floating-running-jobs-btn {
    animation: none;
  }
}
</style>
