<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import Icon from '../../../frontend/ui/Icon.vue'
import type { KnowledgeCollectionView, KnowledgeEntryMeta, KnowledgeTagFacetView } from '../scripts/KnowledgePanelApi'

/**
 * Cột trái của màn knowledge: cụm icon action + tab scope + ô tìm (neo cố định),
 * dưới là 3 nhóm `<details>` — tài liệu · collection · tag — mỗi nhóm cuộn riêng.
 *
 * Thuần trình bày: mọi thao tác đi lên `KnowledgePanel` qua emit, component này
 * không gọi API.
 */
const props = defineProps<{
  entries: KnowledgeEntryMeta[]
  loading: boolean
  collections: KnowledgeCollectionView[]
  /** Lỗi đọc DB — hiện ra và khoá đường ghi của nhóm collection/tag. */
  collectionsError: string
  activeCollection: string
  tags: KnowledgeTagFacetView[]
  tagFilter: string[]
  /** Entry đang hiển thị ở main — null khi chưa chọn. */
  viewingId: string | null
  /** Entry đang xoá dở; chặn double-click ngay ở nút. */
  busyId: string | null
}>()

const emit = defineEmits<{
  upload: []
  download: []
  new: []
  view: [id: string]
  edit: [id: string]
  'download-entry': [id: string]
  delete: [id: string]
  'select-collection': [id: string]
  'new-collection': []
  'edit-collection': [collection: KnowledgeCollectionView]
  'delete-collection': [id: string]
  'toggle-tag': [tag: string]
  'new-tag': []
  'edit-tag': [tag: KnowledgeTagFacetView]
}>()

const scope = defineModel<string>('scope', { required: true })
const query = defineModel<string>('query', { required: true })

const { t } = useI18nHelpers()

const SCOPE_TABS = ['project', 'system', 'global'] as const

/** Màu tag đi vào CSS qua biến inline; `.chip-tag` ở `_shell.scss` đọc chúng. */
function tagStyle(tag: KnowledgeTagFacetView) {
  return {
    '--tag-c': `var(--tag-${tag.color})`,
    '--tag-c-rgb': `var(--tag-${tag.color}-rgb)`,
  }
}
</script>

<template>
  <div class="knowledge-side-menu">
    <!-- Icon button, không text (docs/ui-buttons.md): 3 action của cả màn. -->
    <div class="knowledge-side-actions">
      <button
        type="button"
        class="icon-btn"
        :title="t('knowledge.actions.upload')"
        :aria-label="t('knowledge.actions.upload')"
        @click="emit('upload')"
      >
        <Icon name="upload" />
      </button>
      <button
        type="button"
        class="icon-btn"
        :disabled="!entries.length"
        :title="entries.length ? t('knowledge.actions.download') : t('knowledge.actions.downloadHint')"
        :aria-label="t('knowledge.actions.download')"
        @click="emit('download')"
      >
        <Icon name="download" />
      </button>
      <button
        type="button"
        class="icon-btn"
        :title="t('knowledge.actions.create')"
        :aria-label="t('knowledge.actions.create')"
        @click="emit('new')"
      >
        <Icon name="plus" />
      </button>
    </div>

    <div class="knowledge-side-filters">
      <div class="knowledge-scope-tabs">
        <button
          v-for="s in SCOPE_TABS"
          :key="s"
          type="button"
          class="knowledge-scope-tab"
          :class="{ active: scope === s }"
          @click="scope = s"
        >{{ t(`knowledge.scopeTabs.${s}`) }}</button>
      </div>
      <input
        v-model="query"
        class="cfg-input cfg-input-sm"
        :placeholder="t('knowledge.filters.searchPlaceholder')"
      />
      <p v-if="collectionsError" class="knowledge-side-error">
        {{ t('knowledge.collections.loadFailed', { error: collectionsError }) }}
      </p>
    </div>

    <div class="knowledge-side-groups">
      <!-- ── Tài liệu ────────────────────────────────────────────────────── -->
      <details class="knowledge-group" open>
        <summary>
          <span>{{ t('knowledge.list.title') }}</span>
          <span class="muted">({{ entries.length }})</span>
        </summary>
        <ul class="knowledge-list">
          <li v-if="loading" class="muted knowledge-list-msg">{{ t('knowledge.list.loading') }}</li>
          <li v-else-if="!entries.length" class="muted knowledge-list-msg">{{ t('knowledge.list.empty') }}</li>
          <li
            v-for="e in entries"
            :key="e.id"
            class="knowledge-list-item"
            :class="{ active: viewingId === e.id }"
          >
            <button
              type="button"
              class="knowledge-list-name"
              :title="e.id"
              @click="emit('view', e.id)"
            >{{ e.title }}</button>
            <div class="icon-btn-group">
              <button
                type="button"
                class="icon-btn icon-btn-inline"
                :title="t('knowledge.list.view')"
                :aria-label="t('knowledge.list.view')"
                @click="emit('view', e.id)"
              >
                <Icon name="eye" :size="14" />
              </button>
              <button
                type="button"
                class="icon-btn icon-btn-inline"
                :title="t('knowledge.list.edit')"
                :aria-label="t('knowledge.list.edit')"
                @click="emit('edit', e.id)"
              >
                <Icon name="pencil" :size="14" />
              </button>
              <button
                type="button"
                class="icon-btn icon-btn-inline"
                :title="t('knowledge.list.download')"
                :aria-label="t('knowledge.list.download')"
                @click="emit('download-entry', e.id)"
              >
                <Icon name="download" :size="14" />
              </button>
              <!-- Xoá đứng cuối: action phá huỷ không nằm cạnh action thường. -->
              <button
                type="button"
                class="icon-btn icon-btn-inline danger"
                :disabled="busyId === e.id"
                :title="t('knowledge.list.delete')"
                :aria-label="t('knowledge.list.delete')"
                @click="emit('delete', e.id)"
              >
                <Icon name="trash" :size="14" />
              </button>
            </div>
          </li>
        </ul>
      </details>

      <!-- ── Collection ──────────────────────────────────────────────────── -->
      <details class="knowledge-group">
        <summary>
          <span>{{ t('knowledge.collections.title') }}</span>
          <span class="muted">({{ collections.length }})</span>
          <!-- `<button>` trong `<summary>` mặc định VẪN toggle `<details>` —
               thiếu `.stop.prevent` là bấm `+` vừa mở dialog vừa gập nhóm. -->
          <button
            type="button"
            class="icon-btn icon-btn-inline knowledge-group-add"
            :disabled="!!collectionsError"
            :title="t('knowledge.collections.add')"
            :aria-label="t('knowledge.collections.add')"
            @click.stop.prevent="emit('new-collection')"
          >
            <Icon name="plus" :size="14" />
          </button>
        </summary>
        <ul class="knowledge-list">
          <li v-if="!collections.length" class="muted knowledge-list-msg">
            {{ t('knowledge.collections.empty') }}
            <span class="knowledge-list-hint">{{ t('knowledge.collections.emptyHint') }}</span>
          </li>
          <li
            v-for="c in collections"
            :key="c.id"
            class="knowledge-list-item"
            :class="{ active: activeCollection === c.id }"
          >
            <button
              type="button"
              class="knowledge-list-name"
              :title="c.description || c.id"
              @click="emit('select-collection', c.id)"
            >
              {{ c.name }}
              <!-- Nhóm rỗng vẫn hiện kèm số `0`: từ khi lên DB đó là trạng thái
                   hợp lệ, lọc mất là vừa tạo xong đã không thấy đâu. -->
              <span class="muted">({{ c.entryCount }} · {{ c.scope }})</span>
            </button>
            <div class="icon-btn-group">
              <button
                type="button"
                class="icon-btn icon-btn-inline"
                :disabled="!!collectionsError"
                :title="t('knowledge.collections.edit')"
                :aria-label="t('knowledge.collections.edit')"
                @click="emit('edit-collection', c)"
              >
                <Icon name="pencil" :size="14" />
              </button>
              <button
                type="button"
                class="icon-btn icon-btn-inline danger"
                :disabled="!!collectionsError"
                :title="t('knowledge.collections.delete')"
                :aria-label="t('knowledge.collections.delete')"
                @click="emit('delete-collection', c.id)"
              >
                <Icon name="trash" :size="14" />
              </button>
            </div>
          </li>
        </ul>
      </details>

      <!-- ── Tag ─────────────────────────────────────────────────────────── -->
      <details class="knowledge-group">
        <summary>
          <span>{{ t('knowledge.tags.title') }}</span>
          <span class="muted">({{ tags.length }})</span>
          <button
            type="button"
            class="icon-btn icon-btn-inline knowledge-group-add"
            :disabled="!!collectionsError"
            :title="t('knowledge.tags.add')"
            :aria-label="t('knowledge.tags.add')"
            @click.stop.prevent="emit('new-tag')"
          >
            <Icon name="plus" :size="14" />
          </button>
        </summary>
        <ul class="knowledge-list">
          <li v-if="!tags.length" class="muted knowledge-list-msg">{{ t('knowledge.tags.empty') }}</li>
          <li v-for="tag in tags" :key="tag.tag" class="knowledge-list-item">
            <button
              type="button"
              class="knowledge-tag-name"
              :title="tag.description || tag.tag"
              @click="emit('toggle-tag', tag.tag)"
            >
              <span
                class="chip chip-tag"
                :class="{ active: tagFilter.includes(tag.tag) }"
                :style="tagStyle(tag)"
              >{{ tag.tag }}</span>
              <span class="muted">({{ tag.count }})</span>
            </button>
            <div class="icon-btn-group">
              <button
                type="button"
                class="icon-btn icon-btn-inline"
                :disabled="!!collectionsError"
                :title="t('knowledge.tags.edit')"
                :aria-label="t('knowledge.tags.edit')"
                @click="emit('edit-tag', tag)"
              >
                <Icon name="pencil" :size="14" />
              </button>
            </div>
          </li>
        </ul>
      </details>
    </div>
  </div>
</template>

<style scoped lang="scss">
/* Chuỗi overflow (docs/ui-overflow.md): mỗi nhóm có vùng cuộn RIÊNG, nên chuỗi
   flex phải đi xuyên qua `<details>` — đó đúng là ca bắt buộc khai
   `::details-content`. Lá duy nhất mang `overflow-y: auto` là `<ul>`. */
.knowledge-side-menu {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.knowledge-side-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.knowledge-side-filters {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.knowledge-side-error {
  margin: 0;
  font-size: 11px;
  color: var(--danger);
}

.knowledge-scope-tabs { display: flex; gap: 6px; }
.knowledge-scope-tab {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.knowledge-scope-tab.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.knowledge-side-groups {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 4px;
}

.knowledge-group {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  flex: 0 0 auto;
}
/* Chỉ nhóm đang mở mới giành chiều cao — ba nhóm đóng thì summary xếp sát nhau. */
.knowledge-group[open] { flex: 1 1 0; }
.knowledge-group::details-content {
  display: flex;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

.knowledge-group > summary {
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
  flex-shrink: 0;
}
.knowledge-group > summary::before { content: '›'; transition: transform 0.15s; }
.knowledge-group[open] > summary::before { transform: rotate(90deg); color: var(--accent); }
.knowledge-group-add { margin-left: auto; }

/* Lá DUY NHẤT cuộn. Không cap `max-height` ở đây: phần chiều cao mà
   `.knowledge-group[open]` giành được ĐÃ là trần rồi, thêm cap nữa chỉ tạo
   khoảng chết bên trong nhóm và đẩy hai nhóm còn lại xuống đáy cột. */
.knowledge-list {
  list-style: none;
  margin: 0;
  padding: 0 0 6px;
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}

.knowledge-list-msg {
  padding: 6px 10px;
  font-size: 12px;
}
.knowledge-list-hint {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.8;
}

.knowledge-list-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  border-radius: 6px;
  font-size: 13px;
}
.knowledge-list-item:hover { background: var(--panel-2); }
.knowledge-list-item.active {
  background: var(--panel-2);
  outline: 1px solid var(--accent);
}

.knowledge-list-name,
.knowledge-tag-name {
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
.knowledge-tag-name {
  display: flex;
  align-items: center;
  gap: 6px;
}
.knowledge-tag-name .chip { border-style: solid; }
.knowledge-tag-name .chip.active { outline: 1px solid var(--accent); }
</style>
