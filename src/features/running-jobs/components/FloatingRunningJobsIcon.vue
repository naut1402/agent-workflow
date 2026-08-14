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
