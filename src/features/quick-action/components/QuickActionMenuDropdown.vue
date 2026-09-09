<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ArtifactMenuNode } from '../lib/menuTypes'

const props = defineProps<{
  node: ArtifactMenuNode
  disabled?: boolean
  runningActionId?: string | null
}>()

const emit = defineEmits<{
  run: [actionId: string]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

function toggle() {
  if (props.disabled) return
  open.value = !open.value
}

function onLeaf(actionId: string) {
  open.value = false
  emit('run', actionId)
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (rootRef.value?.contains(t)) return
  open.value = false
}

onMounted(() => document.addEventListener('click', onDocClick, true))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true))
</script>

<template>
  <div ref="rootRef" class="qa-menu-dropdown" :class="{ open }">
    <button
      type="button"
      class="btn-quick-action qa-menu-trigger"
      :disabled="disabled"
      :title="node.label"
      :aria-label="node.label"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      {{ node.label }}
      <span class="qa-menu-caret" aria-hidden="true">▾</span>
    </button>
    <div v-if="open" class="qa-menu-panel">
      <template v-for="child in node.children ?? []" :key="child.id">
        <button
          v-if="child.action_id"
          type="button"
          class="qa-menu-item"
          :disabled="disabled || runningActionId === child.action_id"
          @click="onLeaf(child.action_id)"
        >
          {{ child.label }}
        </button>
        <div v-else class="qa-menu-nested-group">
          <div class="qa-menu-nested-label">{{ child.label }}</div>
          <button
            v-for="leaf in child.children ?? []"
            :key="leaf.id"
            type="button"
            class="qa-menu-item qa-menu-item-nested"
            :disabled="disabled || !leaf.action_id || runningActionId === leaf.action_id"
            @click="leaf.action_id && onLeaf(leaf.action_id)"
          >
            {{ leaf.label }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.qa-menu-dropdown { position: relative; display: inline-flex; }
.qa-menu-trigger { display: inline-flex; align-items: center; gap: 4px; }
.qa-menu-caret { font-size: 10px; opacity: 0.75; }
.qa-menu-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 60;
  min-width: 180px;
  padding: 6px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.qa-menu-item {
  text-align: left;
  font-size: 12px;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.qa-menu-item:hover:not(:disabled) { background: rgba(var(--accent-rgb), 0.1); color: var(--accent); }
.qa-menu-item:disabled { opacity: 0.45; cursor: default; }
.qa-menu-nested-group { padding: 4px 0 2px; }
.qa-menu-nested-label {
  font-size: 11px;
  color: var(--muted);
  padding: 2px 10px 4px;
  font-weight: 600;
}
.qa-menu-item-nested { padding-left: 18px; }
</style>
