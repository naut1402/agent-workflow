<script setup lang="ts">
/**
 * Node điều phối trên canvas editor. Cố ý **không có nút ✕**: node này chỉ gỡ
 * được bằng cách bỏ tick checkbox "Có node điều phối" ở panel trái — xoá được
 * trên canvas thì canvas và YAML sẽ nói hai chuyện khác nhau.
 *
 * Nó cũng không có handle: nó không nằm trong `steps[]` nên không nối edge với
 * step nào (xem `buildEditorGraph`).
 */
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'

const { t } = useI18nHelpers()

defineProps({
  data: { type: Object, required: true },
})
</script>

<template>
  <div class="onode" :title="t('pipelineEditor.orchestrator.nodeTitle')">
    <div class="onode-label">{{ data.label }}</div>
    <div v-if="data.agent" class="onode-agent">{{ data.agent }}</div>
    <div v-else class="onode-agent onode-agent--missing">
      {{ t('pipelineEditor.orchestrator.noAgent') }}
    </div>
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
.onode-label {
  font-size: 12px;
  font-weight: 600;
}
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
