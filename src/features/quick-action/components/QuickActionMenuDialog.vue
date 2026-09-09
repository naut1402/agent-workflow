<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { onBeforeUnmount, onMounted, ref, toRaw } from 'vue'
import type { ArtifactMenuNode } from '../lib/menuTypes'
import Icon from '../../../core/ui/Icon.vue'

const props = defineProps<{
  menus: ArtifactMenuNode[]
  /** Kept for display of leaf action_id labels; attach happens in the action form. */
  actions: Array<{ id: string; label: string }>
}>()

const emit = defineEmits<{
  save: [menus: ArtifactMenuNode[]]
  close: []
}>()

const { t } = useI18nHelpers()
/** Deep-clone menu tree. `toRaw` only unwraps the top proxy; nested nodes stay
 * reactive and break `structuredClone` — use JSON round-trip so reopen works. */
function cloneMenus(menus: ArtifactMenuNode[]): ArtifactMenuNode[] {
  return JSON.parse(JSON.stringify(toRaw(menus))) as ArtifactMenuNode[]
}

const localMenus = ref<ArtifactMenuNode[]>(cloneMenus(props.menus))
const selectedId = ref<string | null>(null)

function findNode(nodes: ArtifactMenuNode[], id: string): ArtifactMenuNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children) {
      const hit = findNode(n.children, id)
      if (hit) return hit
    }
  }
  return null
}

function findParentList(
  nodes: ArtifactMenuNode[],
  id: string,
): { list: ArtifactMenuNode[]; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { list: nodes, index: i }
    if (nodes[i].children) {
      const hit = findParentList(nodes[i].children!, id)
      if (hit) return hit
    }
  }
  return null
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`
}

function select(id: string) {
  selectedId.value = id
}

function addGroup() {
  const node: ArtifactMenuNode = { id: newId('group'), label: t('quickAction.menu.newGroup'), children: [] }
  if (selectedId.value) {
    const sel = findNode(localMenus.value, selectedId.value)
    if (sel && !sel.action_id) {
      sel.children = sel.children ?? []
      sel.children.push(node)
      select(node.id)
      return
    }
  }
  localMenus.value.push(node)
  select(node.id)
}

function removeSelected() {
  if (!selectedId.value) return
  const hit = findParentList(localMenus.value, selectedId.value)
  if (!hit) return
  hit.list.splice(hit.index, 1)
  selectedId.value = null
}

function moveSelected(dir: -1 | 1) {
  if (!selectedId.value) return
  const hit = findParentList(localMenus.value, selectedId.value)
  if (!hit) return
  const next = hit.index + dir
  if (next < 0 || next >= hit.list.length) return
  const [item] = hit.list.splice(hit.index, 1)
  hit.list.splice(next, 0, item)
}

function renameSelected(label: string) {
  if (!selectedId.value) return
  const node = findNode(localMenus.value, selectedId.value)
  if (node) node.label = label
}

function actionLabel(actionId: string): string {
  return props.actions.find((a) => a.id === actionId)?.label ?? actionId
}

function save() {
  emit('save', cloneMenus(localMenus.value))
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="qa-modal-overlay" @click.self="emit('close')">
    <div class="qa-menu-dialog" role="dialog" aria-modal="true">
      <div class="qa-form-head">
        <h3>{{ t('quickAction.menu.dialogTitle') }}</h3>
        <button
          type="button"
          class="icon-btn"
          :title="t('quickAction.form.close')"
          :aria-label="t('quickAction.form.close')"
          @click="emit('close')"
        >
          <Icon name="close" :size="16" />
        </button>
      </div>
      <p class="muted qa-menu-dialog-hint">{{ t('quickAction.menu.dialogHint') }}</p>

      <div class="qa-menu-dialog-toolbar">
        <button
          type="button"
          class="icon-btn"
          :title="t('quickAction.menu.addGroup')"
          :aria-label="t('quickAction.menu.addGroup')"
          @click="addGroup"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M2.5 5.5h5l1.5-1.5H13.5v8H2.5z" />
            <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M8 7.5v4M6 9.5h4" />
          </svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          :disabled="!selectedId"
          :title="t('quickAction.menu.moveUp')"
          :aria-label="t('quickAction.menu.moveUp')"
          @click="moveSelected(-1)"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M4 9.5l4-4 4 4" />
          </svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          :disabled="!selectedId"
          :title="t('quickAction.menu.moveDown')"
          :aria-label="t('quickAction.menu.moveDown')"
          @click="moveSelected(1)"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M4 6.5l4 4 4-4" />
          </svg>
        </button>
        <button
          type="button"
          class="icon-btn danger"
          :disabled="!selectedId"
          :title="t('quickAction.menu.deleteNode')"
          :aria-label="t('quickAction.menu.deleteNode')"
          @click="removeSelected"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              d="M3.5 5h9M6 5V3.5h4V5M5 5l.5 8h5L11 5"
            />
          </svg>
        </button>
      </div>

      <div class="qa-menu-tree-wrap">
        <ul class="qa-menu-tree">
          <template v-for="node in localMenus" :key="node.id">
            <li
              class="qa-menu-tree-node"
              :class="{ selected: selectedId === node.id, group: !node.action_id }"
              @click.stop="select(node.id)"
            >
              <span class="qa-menu-tree-label">{{ node.label }}</span>
              <span v-if="node.action_id" class="muted qa-menu-tree-meta">→ {{ actionLabel(node.action_id) }}</span>
              <ul v-if="node.children?.length" class="qa-menu-tree qa-menu-tree-nested">
                <li
                  v-for="child in node.children"
                  :key="child.id"
                  class="qa-menu-tree-node"
                  :class="{ selected: selectedId === child.id, group: !child.action_id }"
                  @click.stop="select(child.id)"
                >
                  <span class="qa-menu-tree-label">{{ child.label }}</span>
                  <span v-if="child.action_id" class="muted qa-menu-tree-meta">→ {{ actionLabel(child.action_id) }}</span>
                  <ul v-if="child.children?.length" class="qa-menu-tree qa-menu-tree-nested">
                    <li
                      v-for="grand in child.children"
                      :key="grand.id"
                      class="qa-menu-tree-node"
                      :class="{ selected: selectedId === grand.id }"
                      @click.stop="select(grand.id)"
                    >
                      <span class="qa-menu-tree-label">{{ grand.label }}</span>
                      <span v-if="grand.action_id" class="muted qa-menu-tree-meta">→ {{ actionLabel(grand.action_id) }}</span>
                    </li>
                  </ul>
                </li>
              </ul>
            </li>
          </template>
        </ul>
      </div>

      <div v-if="selectedId && findNode(localMenus, selectedId!) && !findNode(localMenus, selectedId!)!.action_id" class="qa-menu-editor">
        <label class="cfg-label">
          {{ t('quickAction.menu.renameLabel') }}
          <input
            class="cfg-input"
            :value="findNode(localMenus, selectedId!)?.label ?? ''"
            @input="renameSelected(($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>

      <div class="nl-actions">
        <button type="button" class="btn-primary" @click="save">{{ t('quickAction.menu.save') }}</button>
        <button type="button" class="btn-ghost" @click="emit('close')">{{ t('quickAction.form.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.qa-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.qa-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: nowrap;
}
.qa-form-head h3 {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
}
.qa-form-head .icon-btn { flex-shrink: 0; }
.qa-menu-dialog {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  width: min(720px, 94vw);
  max-height: 88vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.qa-menu-dialog-hint { margin: 0; font-size: 13px; }
.qa-menu-dialog-toolbar { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
.qa-menu-tree-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  max-height: 240px;
  overflow: auto;
}
.qa-menu-tree { list-style: none; margin: 0; padding: 0; }
.qa-menu-tree-nested { margin-left: 16px; margin-top: 4px; }
.qa-menu-tree-node {
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.qa-menu-tree-node:hover { background: rgba(var(--accent-rgb), 0.08); }
.qa-menu-tree-node.selected { background: rgba(var(--accent-rgb), 0.15); outline: 1px solid var(--accent); }
.qa-menu-tree-label { font-weight: 500; }
.qa-menu-tree-meta { margin-left: 8px; font-size: 12px; }
.qa-menu-editor { display: flex; flex-direction: column; gap: 8px; }
</style>
