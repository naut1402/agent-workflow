<script setup lang="ts">
/**
 * Mục đóng/mở của sub-sidebar editor — cùng pattern `<details>` + chevron với
 * nhóm archived của Task list (Monitor).
 *
 * `open` do cha giữ (một `Set` khoá section) nên trạng thái sống sót qua re-render
 * và cho phép "bấm icon ở dải thu gọn → mở đúng section".
 */
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
  flex: 1 1 auto;
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
