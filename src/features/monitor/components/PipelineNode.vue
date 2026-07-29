<script setup lang="ts">
import { ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { useChatSurface } from '../../nl-chat/composables/useChatSurface'

const props = defineProps({
  data: { type: Object, required: true },
})

const { t } = useI18n()
const { openTaskChat } = useChatSurface()

// Hover popover: chat with the runner of THIS step — opens the floating chat
// window scoped to (taskId, stepId) so it replays that CLI session's history.
const hovered = ref(false)

function onChat(): void {
  if (!props.data.taskId) return
  openTaskChat({
    taskId: props.data.taskId,
    stepId: props.data.stepId,
    stepLabel: props.data.label,
  })
}
const STATUS_ICON = { done: '✓', active: '▶', waiting: '⏸', pending: '○' }

function bubbleTitle(data: Record<string, any>): string | undefined {
  if (data.running) return t('monitor.pipelineNode.running')
  if (data.status === 'waiting') return t('monitor.pipelineNode.clickToApprove')
  if (data.runnable) return t('monitor.pipelineNode.clickToRun')
  return undefined
}
</script>

<template>
  <div
    class="pnode"
    :class="[
      data.status,
      {
        'pnode-waiting': data.status === 'waiting',
        'pnode-runnable': !!data.runnable,
        'pnode-running': data.running,
      },
    ]"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <div v-if="hovered && data.taskId" class="pnode-popover">
      <button type="button" class="pnode-chat-btn" :title="t('monitor.pipelineNode.chatWithRunner')" @click.stop="onChat">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20.5 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 20.5 12z" />
        </svg>
        {{ t('monitor.pipelineNode.chat') }}
      </button>
    </div>
    <Handle type="target" :position="Position.Left" />
    <div class="pnode-bubble" :title="bubbleTitle(data)">
      {{ data.running ? '⏳' : (STATUS_ICON[data.status] || '○') }}
    </div>
    <div class="pnode-label">{{ data.label }}</div>
    <div class="pnode-sub">{{ data.status }}</div>
    <span
      v-if="data.qa_count > 0"
      class="qa-badge"
      :title="t('monitor.pipelineNode.qaCount', { count: data.qa_count })"
    >
      {{ data.qa_count }}Q
    </span>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped lang="scss">
.pnode {
  position: relative;
}
.pnode-popover {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  z-index: 5;
}
.pnode-chat-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  cursor: pointer;
}
.pnode-chat-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.pnode-waiting .pnode-bubble,
.pnode-runnable .pnode-bubble {
  cursor: pointer;
}
.pnode-waiting .pnode-bubble:hover,
.pnode-runnable .pnode-bubble:hover {
  filter: brightness(1.15);
}
.pnode-running .pnode-bubble {
  animation: pnode-running-pulse 1.2s ease-in-out infinite;
}
@keyframes pnode-running-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
