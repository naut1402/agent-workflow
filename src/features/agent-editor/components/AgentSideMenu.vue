<script setup lang="ts">
import { computed } from 'vue'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import Icon from '../../../frontend/ui/Icon.vue'
import type { AgentMeta } from '../scripts/agentEditorApi'

const props = defineProps<{
  agents: AgentMeta[]
  /** `${scope}:${name}` của agent đang xem ở main — null khi chưa chọn. */
  selectedKey: string | null
  /** Dòng đang xoá dở; chặn double-click ngay ở nút. */
  busyKey: string | null
  canExport: boolean
}>()

const emit = defineEmits<{
  new: []
  templates: []
  nl: []
  export: []
  view: [agent: AgentMeta]
  edit: [agent: AgentMeta]
  delete: [agent: AgentMeta]
}>()

const { t } = useI18nHelpers()

const keyOf = (a: AgentMeta) => `${a.scope}:${a.name}`

// Nhóm rỗng không render `<details>` (E5) — lọc ngay ở computed để template
// chỉ còn một `v-for` thuần, không trộn `v-if` cùng cấp.
const groups = computed(() =>
  [
    {
      scope: 'project',
      label: t('agentEditor.list.groupProject'),
      items: props.agents.filter((a) => a.scope === 'project'),
    },
    {
      scope: 'global',
      label: t('agentEditor.list.groupGlobal'),
      items: props.agents.filter((a) => a.scope === 'global'),
    },
  ].filter((g) => g.items.length > 0),
)
</script>

<template>
  <div class="agent-side-menu">
    <div class="agent-side-actions">
      <button type="button" class="btn-primary btn-sm" @click="emit('new')">
        {{ t('agentEditor.list.newButton') }}
      </button>
      <button type="button" class="btn-ghost btn-sm" @click="emit('templates')">
        {{ t('agentEditor.actions.templateCopy') }}
      </button>
      <button type="button" class="btn-ghost btn-sm" @click="emit('nl')">
        {{ t('agentEditor.actions.buildNl') }}
      </button>
      <button
        type="button"
        class="btn-ghost btn-sm"
        :disabled="!canExport"
        :title="canExport ? undefined : t('agentEditor.list.exportHint')"
        @click="emit('export')"
      >
        {{ t('agentEditor.actions.export') }}
      </button>
    </div>

    <div class="agent-side-groups">
      <p v-if="!groups.length" class="muted agent-list-empty">{{ t('agentEditor.list.empty') }}</p>
      <details v-for="g in groups" :key="g.scope" class="agent-group" open>
        <summary>
          <span>{{ g.label }}</span>
          <span class="muted">({{ g.items.length }})</span>
        </summary>
        <ul class="agent-list">
          <li
            v-for="a in g.items"
            :key="keyOf(a)"
            class="agent-list-item"
            :class="{ active: selectedKey === keyOf(a) }"
          >
            <button
              type="button"
              class="agent-list-name"
              :title="a.description || a.name"
              @click="emit('view', a)"
            >{{ a.name }}</button>
            <span v-if="a.model" class="chip chip-xs">{{ a.model }}</span>
            <div class="icon-btn-group">
              <button
                type="button"
                class="icon-btn icon-btn-inline"
                :title="t('agentEditor.list.view')"
                :aria-label="t('agentEditor.list.view')"
                @click="emit('view', a)"
              >
                <Icon name="eye" :size="14" />
              </button>
              <button
                v-if="a.editable !== false"
                type="button"
                class="icon-btn icon-btn-inline"
                :title="t('agentEditor.list.edit')"
                :aria-label="t('agentEditor.list.edit')"
                @click="emit('edit', a)"
              >
                <Icon name="pencil" :size="14" />
              </button>
              <button
                type="button"
                class="icon-btn icon-btn-inline danger"
                :disabled="busyKey === keyOf(a)"
                :title="t('agentEditor.list.delete')"
                :aria-label="t('agentEditor.list.delete')"
                @click="emit('delete', a)"
              >
                <Icon name="trash" :size="14" />
              </button>
            </div>
          </li>
        </ul>
      </details>
    </div>
  </div>
</template>

<style scoped lang="scss">
/* Chuỗi overflow theo docs/ui-overflow.md: chỉ `.agent-side-groups` là lá mang
   `overflow-y: auto`; mọi tầng trên nó `overflow: hidden` + `min-height: 0`. */
.agent-side-menu {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.agent-side-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.agent-side-groups {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}

/* 🚫 Cố ý KHÔNG khai `.agent-group::details-content`: docs/ui-overflow.md chỉ
   đòi khai nó khi chuỗi flex phải đi XUYÊN QUA `<details>`. Ở đây chuỗi dừng
   ở `.agent-side-groups` (lá mang `overflow-y: auto`), còn `<details>` chỉ là
   block con chiều cao tự nhiên — thêm `flex: 1 1 0` + `overflow: hidden` vào
   `::details-content` sẽ cắt mất nội dung nhóm. */
.agent-group > summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.agent-group > summary::before { content: '›'; transition: transform 0.15s; }
.agent-group[open] > summary::before { transform: rotate(90deg); color: var(--accent); }

.agent-list { list-style: none; margin: 0 0 6px; padding: 0; }

.agent-list-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 8px;
  border-radius: 6px;
  font-size: 13px;
}
.agent-list-item:hover { background: var(--panel-2); }
.agent-list-item.active {
  background: var(--panel-2);
  outline: 1px solid var(--accent);
}

.agent-list-name {
  flex: 1 1 auto;
  min-width: 0;
  background: none;
  border: none;
  padding: 6px 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-list-empty { padding: 10px; font-size: 13px; }
</style>
