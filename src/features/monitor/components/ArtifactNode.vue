<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({
  data: { type: Object, required: true },
})

const { t } = useI18nHelpers()

const isProduces = () => props.data?.kind === 'produces'
const isKnowledge = () => props.data?.kind === 'knowledge'
</script>

<template>
  <div
    class="anode"
    :class="{
      produces: isProduces(),
      knowledge: isKnowledge(),
    }"
  >
    <Handle
      v-if="isProduces()"
      type="target"
      :position="Position.Left"
    />
    <div class="anode-head">
      <span class="anode-kind" aria-hidden="true">{{ isKnowledge() ? '◈' : '▣' }}</span>
      <span class="anode-label">{{ data.label }}</span>
    </div>
    <ul v-if="isProduces() && data.files?.length" class="anode-list">
      <li
        v-for="f in data.files"
        :key="f.name"
        class="anode-file"
        :class="f.exists ? 'exists' : 'missing'"
        :title="f.exists ? t('monitor.artifactNode.exists') : t('monitor.artifactNode.missing')"
      >
        <span class="anode-file-mark">{{ f.exists ? '✓' : '○' }}</span>
        <span class="anode-file-name">{{ f.name }}</span>
      </li>
    </ul>
    <ul v-else-if="isKnowledge() && data.entries?.length" class="anode-list">
      <li
        v-for="(e, i) in data.entries"
        :key="`${e.id}-${e.stepId}-${i}`"
        class="anode-entry"
      >
        <span class="anode-entry-id">{{ e.id }}</span>
        <span class="anode-entry-step">{{ t('monitor.artifactNode.fromStep', { stepId: e.stepId }) }}</span>
      </li>
    </ul>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped lang="scss">
.anode {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  min-width: 100px;
  max-width: 160px;
  font-size: 11px;
  cursor: default;
  position: relative;
}

.anode.produces {
  border-color: var(--border);
}

.anode.knowledge {
  border-style: dashed;
  border-color: var(--muted);
}

.anode-head {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.anode-kind {
  color: var(--muted);
  font-size: 10px;
  line-height: 1;
}

.anode-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.anode-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.anode-file {
  display: flex;
  align-items: center;
  gap: 4px;
  line-height: 1.3;
  color: var(--text);
  overflow: hidden;
}

.anode-file-mark {
  flex-shrink: 0;
  font-size: 10px;
}

.anode-file.exists .anode-file-mark {
  color: var(--done);
}

.anode-file.missing {
  color: var(--muted);
}

.anode-file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.anode-entry {
  display: flex;
  flex-direction: column;
  gap: 0;
  line-height: 1.25;
}

.anode-entry-id {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.anode-entry-step {
  font-size: 9px;
  color: var(--muted);
}
</style>
