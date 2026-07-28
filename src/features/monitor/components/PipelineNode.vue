<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'

defineProps({
  data: { type: Object, required: true },
})

const { t } = useI18n()
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
