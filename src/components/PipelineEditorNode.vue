<script setup>
import { ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  previewState: {
    type: String,
    default: 'idle',
    validator: (v) => ['idle', 'pending', 'active', 'done', 'hitl'].includes(v),
  },
})

const emit = defineEmits(['edit', 'delete'])

const editing = ref(false)
const labelDraft = ref('')

const previewLabels = {
  pending: '⏳ Chờ',
  active: '▶ Đang chạy',
  done: '✓ Xong',
  hitl: '⏸ HITL',
}

function startEdit() {
  labelDraft.value = props.data.label || ''
  editing.value = true
}

function commitLabel() {
  if (labelDraft.value.trim()) {
    emit('edit', props.id, { ...props.data, label: labelDraft.value.trim() })
  }
  editing.value = false
}
</script>

<template>
  <div
    class="node-editor"
    :class="{
      'node-state-pending': previewState === 'pending',
      'node-state-active': previewState === 'active',
      'node-state-done': previewState === 'done',
      'node-state-hitl': previewState === 'hitl',
    }"
  >
    <Handle type="target" :position="Position.Left" />

    <span
      v-if="previewState !== 'idle'"
      class="preview-status"
      :class="`preview-status--${previewState}`"
    >{{ previewLabels[previewState] }}</span>

    <div class="node-editor-head">
      <span v-if="!editing" class="node-editor-label" @dblclick="startEdit">
        {{ data.label || data.agent || id }}
      </span>
      <input
        v-else
        v-model="labelDraft"
        class="node-editor-input"
        @blur="commitLabel"
        @keydown.enter="commitLabel"
        @keydown.escape="editing = false"
        autofocus
      />
      <div class="node-editor-actions">
        <button class="node-btn" title="Configure" @click.stop="emit('edit', id, data)">✎</button>
        <button class="node-btn node-btn-del" title="Delete" @click.stop="emit('delete', id)">✕</button>
      </div>
    </div>

    <div v-if="data.agent" class="node-editor-agent">{{ data.agent }}</div>

    <div v-if="data.skills?.length" class="node-editor-skills">
      <span v-for="sk in data.skills" :key="sk" class="chip chip-skill">{{ sk }}</span>
    </div>

    <Handle type="source" :position="Position.Right" />
  </div>
</template>
