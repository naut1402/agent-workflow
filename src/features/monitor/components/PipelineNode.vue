<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'

defineProps({
  data: { type: Object, required: true },
})

const { t } = useI18n()
const STATUS_ICON = { done: '✓', active: '▶', waiting: '⏸', pending: '○' }
</script>

<template>
  <div class="pnode" :class="[data.status, { 'pnode-waiting': data.status === 'waiting' }]">
    <Handle type="target" :position="Position.Left" />
    <div
      class="pnode-bubble"
      :title="data.status === 'waiting' ? t('monitor.pipelineNode.clickToApprove') : undefined"
    >
      {{ STATUS_ICON[data.status] || '○' }}
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
.pnode-waiting .pnode-bubble {
  cursor: pointer;
}
.pnode-waiting .pnode-bubble:hover {
  filter: brightness(1.15);
}
</style>
