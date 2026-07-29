<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { useChatSurface } from '../../nl-chat/composables/useChatSurface'

const props = defineProps({
  data: { type: Object, required: true },
})

const { t } = useI18n()
const { openTaskChat } = useChatSurface()

// Action row pinned to the node's top-right corner. It is always visible (a
// hover-only popover sitting outside the node lost hover the moment the cursor
// travelled to it, so the button vanished before it could be clicked).
//
// Run mirrors what clicking the node does, and shows under exactly the same
// condition (`data.runnable`); chat opens the floating window scoped to
// (taskId, stepId) so it replays that CLI session's history.

function onRun(): void {
  props.data.onRun?.()
}

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
  >
    <div class="pnode-actions">
      <button
        v-if="data.runnable"
        type="button"
        class="pnode-action pnode-run-btn"
        :title="t('monitor.pipelineNode.clickToRun')"
        :aria-label="t('monitor.pipelineNode.run')"
        @click.stop="onRun"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </button>
      <button
        v-if="data.taskId"
        type="button"
        class="pnode-action pnode-chat-btn"
        :title="t('monitor.pipelineNode.chatWithRunner')"
        :aria-label="t('monitor.pipelineNode.chat')"
        @click.stop="onChat"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20.5 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 20.5 12z" />
        </svg>
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
/* Pinned inside the node's top-right corner — always reachable, no hover race. */
.pnode-actions {
  position: absolute;
  top: 3px;
  right: 4px;
  display: flex;
  gap: 2px;
  z-index: 5;
}
.pnode-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  padding: 0;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  opacity: 0.75;
  cursor: pointer;
}
.pnode-action:hover {
  opacity: 1;
  border-color: var(--accent);
  color: var(--accent);
}
.pnode-run-btn {
  color: var(--active);
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
