<script setup lang="ts">
defineProps({
  title: { type: String, required: true },
  count: { type: Number, default: null },
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle'])
</script>

<template>
  <details class="editor-section" :open="open">
    <summary class="editor-section-head" @click.prevent="emit('toggle')">
      <span class="editor-section-title">{{ title }}</span>
      <span v-if="count !== null" class="editor-section-count">{{ count }}</span>
    </summary>
    <div class="editor-section-body">
      <slot />
    </div>
  </details>
</template>

<style scoped lang="scss">
.editor-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid var(--border);
}
.editor-section[open] {
  flex: 1 1 0;
  overflow: hidden;
}
.editor-section:not([open]) {
  flex: 0 0 auto;
}
// xem docs/architecture/code/pipeline-editor.md §6
.editor-section[open]::details-content {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

.editor-section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  user-select: none;
  list-style: none;
  flex-shrink: 0;
}
.editor-section-head::-webkit-details-marker { display: none; }
.editor-section-head::before {
  content: '›';
  color: var(--muted);
  display: inline-block;
  transition: transform 0.15s;
}
.editor-section[open] > .editor-section-head::before {
  transform: rotate(90deg);
  color: var(--accent);
}
.editor-section-head:hover { color: var(--accent); }

.editor-section-title { flex: 1; }

.editor-section-count {
  font-size: 10px;
  color: var(--muted);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 6px;
}

.editor-section-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  flex: 1;
}
</style>
