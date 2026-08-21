<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useChatSurface } from '../../nl-chat/composables/useChatSurface'

const props = defineProps({
  data: { type: Object, required: true },
})

const { t } = useI18nHelpers()
const { openTaskChat } = useChatSurface()

// Actions sit ON the node's top border (the border runs through their middle)
// and are always visible — a hover-only popover outside the node lost hover the
// moment the cursor travelled to it, so the button vanished before it could be
// clicked. Run is centred on the node, chat sits at the top-right corner.
//
// Run mirrors what clicking the node does, and shows under exactly the same
// condition (`data.runnable`).
//
// Chat only appears for a step that has actually run (`data.executed`, computed
// in PipelineView) — a step that never ran has no CLI session, so there is no
// history to replay.
const hasRunHistory = computed(() => Boolean(props.data.taskId) && Boolean(props.data.executed))

function onRun(): void {
  props.data.onRun?.()
}

function onReset(): void {
  props.data.onReset?.()
}

function onStop(): void {
  props.data.onStop?.()
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
  if (data.recovering) return t('monitor.pipelineNode.awaitingRecovery')
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
        'pnode-running': data.running && !data.recovering,
        'pnode-recovering': !!data.recovering,
      },
    ]"
  >
    <div class="pnode-actions">
      <button
        v-if="data.running"
        type="button"
        class="pnode-action pnode-action-center pnode-stop-btn"
        :title="t('monitor.pipelineNode.clickToStop')"
        :aria-label="t('monitor.pipelineNode.stop')"
        @click.stop="onStop"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" />
        </svg>
      </button>
      <button
        v-else-if="data.runnable"
        type="button"
        class="pnode-action pnode-action-center pnode-run-btn"
        :title="t('monitor.pipelineNode.clickToRun')"
        :aria-label="t('monitor.pipelineNode.run')"
        @click.stop="onRun"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </button>
      <button
        v-else-if="data.resettable"
        type="button"
        class="pnode-action pnode-action-center pnode-reset-btn"
        :title="t('monitor.pipelineNode.clickToReset')"
        :aria-label="t('monitor.pipelineNode.reset')"
        @click.stop="onReset"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M1 4v6h6" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </button>
      <button
        v-if="hasRunHistory"
        type="button"
        class="pnode-action pnode-action-right pnode-chat-btn"
        :title="t('monitor.pipelineNode.chatWithRunner')"
        :aria-label="t('monitor.pipelineNode.chat')"
        @click.stop="onChat"
      >
        <svg
          width="15"
          height="15"
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
      {{ data.recovering ? '⏸' : (data.running ? '⏳' : (STATUS_ICON[data.status] || '○')) }}
    </div>
    <div class="pnode-label">{{ data.label }}</div>
    <div class="pnode-sub">{{ data.recovering ? t('monitor.pipelineNode.awaitingRecovery') : data.status }}</div>
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
/* Always reachable (no hover race): the buttons straddle the node's top border,
   which passes through their vertical middle. */
.pnode-actions {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}
.pnode-action {
  position: absolute;
  /* The containing block is the padding box, so -1px lifts the button by half
     the node's 2px border — its middle then lands on the border line. */
  top: -1px;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  /* Borderless + hover scale, per docs/ui-buttons.md (.icon-btn). */
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: transform 0.12s ease, color 0.12s ease;
}
.pnode-action:hover {
  color: var(--text);
}
/* The positioning transform is repeated in each hover rule so the scale
   composes with it instead of replacing it. */
.pnode-action-center {
  left: 50%;
  transform: translate(-50%, -50%);
}
.pnode-action-center:hover {
  transform: translate(-50%, -50%) scale(1.15);
}
.pnode-action-right {
  right: 4px;
  transform: translateY(-50%);
}
.pnode-action-right:hover {
  transform: translateY(-50%) scale(1.15);
}
.pnode-reset-btn {
  color: var(--waiting);
}
.pnode-stop-btn {
  color: var(--danger);
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
.pnode-recovering .pnode-bubble {
  animation: pnode-recovering-pulse 2s ease-in-out infinite;
  color: var(--waiting, #d97706);
}
@keyframes pnode-recovering-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.65;
  }
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
