<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'

const { t } = useI18nHelpers()

defineProps({
  data: { type: Object, required: true },
})

const emit = defineEmits(['edit'])
</script>

<template>
  <div class="onode" :title="t('pipelineEditor.orchestrator.nodeTitle')">
    <div class="onode-head">
      <div class="onode-label">{{ data.label }}</div>
      <button
        class="node-btn"
        :title="t('pipelineEditor.orchestrator.editButton')"
        @click.stop="emit('edit')"
      >✎</button>
    </div>
    <div v-if="data.agent" class="onode-agent">{{ data.agent }}</div>
    <div v-else class="onode-agent onode-agent--missing">
      {{ t('pipelineEditor.orchestrator.noAgent') }}
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped lang="scss">
.onode {
  background: var(--panel-2);
  border: 2px dashed var(--accent);
  border-radius: 10px;
  padding: 8px 14px;
  min-width: 140px;
  text-align: center;
  cursor: default;
}
.onode-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.onode-label {
  font-size: 12px;
  font-weight: 600;
}
.node-btn {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  padding: 0 3px;
  font-size: 12px;
  line-height: 1;
  // xem docs/architecture/code/pipeline-editor.md §1
  pointer-events: auto;
}
.node-btn:hover { color: var(--text); }
.onode-agent {
  font-size: 10px;
  color: var(--muted);
  margin-top: 2px;
  word-break: break-all;
}
.onode-agent--missing {
  color: var(--waiting, #b8860b);
}
</style>
