<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const { t } = useI18nHelpers()

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  previewState: {
    type: String,
    default: 'idle',
    validator: (v: any) => ['idle', 'pending', 'active', 'done', 'hitl'].includes(v),
  },
})

const emit = defineEmits(['edit', 'delete'])

const editing = ref(false)
const labelDraft = ref('')

const previewLabels = computed<Record<string, string>>(() => ({
  pending: t('pipelineEditor.preview.status.pending'),
  active: t('pipelineEditor.preview.status.active'),
  done: t('pipelineEditor.preview.status.done'),
  hitl: t('pipelineEditor.preview.status.hitl'),
}))

const hasGate = computed(() => {
  const mode = props.data?.hitl?.mode
  return Boolean(mode) && mode !== 'none'
})

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

    <!-- c.3 — nhãn gate nằm trên edge đi ra, nhưng step cuối không có edge nào;
         badge trên node là chỗ duy nhất thấy được gate của nó. -->
    <div v-if="hasGate" class="node-editor-gate">
      <span aria-hidden="true">⏸</span>
      <span v-if="data.hitl?.gate_id" class="node-editor-gate-id">{{ data.hitl.gate_id }}</span>
    </div>

    <div v-if="data.agent" class="node-editor-agent">{{ data.agent }}</div>


    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped lang="scss">
.node-editor { position: relative; }
.node-editor.node-state-pending { opacity: 0.45; }
.node-editor.node-state-active {
  border-color: var(--active);
  box-shadow: 0 0 10px rgba(var(--accent-rgb), 0.45);
  animation: preview-pulse 1s ease-in-out infinite;
}
.node-editor.node-state-done { border-color: var(--done); opacity: 0.75; }
.node-editor.node-state-hitl {
  border-color: var(--waiting);
  box-shadow: 0 0 10px rgba(227, 179, 65, 0.4);
}

@keyframes preview-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(var(--accent-rgb), 0.35); }
  50% { box-shadow: 0 0 14px rgba(var(--accent-rgb), 0.55); }
}

.preview-status {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 10px;
  white-space: nowrap;
  z-index: 2;
  pointer-events: none;
}
.preview-status--pending { background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); }
.preview-status--active { background: var(--active); color: #fff; }
.preview-status--done { background: var(--done); color: #0f1419; }
.preview-status--hitl { background: var(--waiting); color: #0f1419; }

/* ── Pipeline editor node ───────────────────────────────────────────────── */
.node-editor {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  min-width: 160px;
  max-width: 200px;
  font-size: 12px;
  position: relative;
}
.node-editor:hover { border-color: var(--accent); }

.node-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.node-editor-label { font-weight: 600; flex: 1; }
.node-editor-input {
  flex: 1;
  background: var(--panel-2);
  border: 1px solid var(--accent);
  color: var(--text);
  border-radius: 4px;
  padding: 2px 5px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.node-editor-actions { display: flex; gap: 3px; }
.node-btn {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  padding: 0 3px;
  font-size: 12px;
  line-height: 1;
}
.node-btn:hover { color: var(--text); }
.node-btn-del:hover { color: var(--danger); }
.node-editor-gate {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 4px;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  color: var(--waiting);
  background: rgba(227, 179, 65, 0.14);
  border: 1px solid rgba(227, 179, 65, 0.4);
}
.node-editor-gate-id {
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-editor-agent { font-size: 10px; color: var(--accent); margin-top: 3px; }
</style>
