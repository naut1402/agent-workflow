<script setup>
import { Handle, Position } from '@vue-flow/core'

defineProps({
  data: { type: Object, required: true },
})

const STATUS_ICON = { done: '✓', active: '▶', waiting: '⏸', pending: '○' }
</script>

<template>
  <div class="pnode" :class="data.status">
    <Handle type="target" :position="Position.Left" />
    <div class="pnode-bubble">{{ STATUS_ICON[data.status] || '○' }}</div>
    <div class="pnode-label">{{ data.label }}</div>
    <div class="pnode-sub">{{ data.status }}</div>
    <span v-if="data.qa_count > 0" class="qa-badge" :title="`${data.qa_count} câu hỏi blocking`">
      {{ data.qa_count }}Q
    </span>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
