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
