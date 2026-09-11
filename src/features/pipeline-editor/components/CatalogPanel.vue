<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { ref, computed, watch } from 'vue'
import { useSearch } from '../../../frontend/composables/useSearch'
import CollapsibleSection from './CollapsibleSection.vue'

const { t } = useI18nHelpers()

const props = defineProps({
  catalog: { type: Object as () => any, required: true }, // { skills: [], agents: [] }
  /** Khoá section đang mở, do PipelineEditor giữ (dùng chung với RulesPanel). */
  openSections: { type: Object as () => Set<string>, default: () => new Set(['agents']) },
})

const emit = defineEmits(['toggle-section'])

// Một state cho mỗi danh sách — control lọc phải thuộc về đúng mục nó phục vụ,
// nếu không người dùng không biết select đang lọc danh sách nào.
const agentSource = ref('all')
const skillSource = ref('all')

const SOURCE_OPTIONS = [
  { value: 'all', labelKey: 'pipelineEditor.catalog.sourceAll' },
  { value: 'project', labelKey: 'pipelineEditor.catalog.sourceProject' },
  { value: 'repo', labelKey: 'pipelineEditor.catalog.sourceRepo' },
  { value: 'plugin', labelKey: 'pipelineEditor.catalog.sourcePlugin' },
  { value: 'user', labelKey: 'pipelineEditor.catalog.sourceUser' },
  { value: 'cursor', labelKey: 'pipelineEditor.catalog.sourceCursor' },
  { value: 'dashboard', labelKey: 'pipelineEditor.catalog.sourceDashboard' },
]

/** Gom `source` thô về đúng một bucket lọc được: `repo:x` -> `repo`, `plugin:y` -> `plugin`. */
function sourceBucket(source: string): string {
  const src = source || ''
  if (src.startsWith('repo:')) return 'repo'
  if (src.startsWith('plugin:')) return 'plugin'
  return src
}

/** Chỉ chào những option thực có trong dữ liệu — không để chọn giá trị lọc ra rỗng vô cớ. */
function optionsFor(items: any[]) {
  const present = new Set(items.map((i) => sourceBucket(i.source)).filter(Boolean))
  return SOURCE_OPTIONS.filter((o) => o.value === 'all' || present.has(o.value))
}

function bySource(items: any[], selected: string) {
  if (selected === 'all') return items
  return items.filter((i) => sourceBucket(i.source) === selected)
}

// Option sinh từ danh sách THÔ, không từ danh sách đã lọc — nếu không, chọn một
// nguồn sẽ làm tập option co lại còn đúng nguồn đó.
const rawAgents = computed<any[]>(() => props.catalog.agents || [])
const rawSkills = computed<any[]>(() => props.catalog.skills || [])

const agentSourceOptions = computed(() => optionsFor(rawAgents.value))
const skillSourceOptions = computed(() => optionsFor(rawSkills.value))

const agentItems = computed<any[]>(() => bySource(rawAgents.value, agentSource.value))
const skillItems = computed<any[]>(() => bySource(rawSkills.value, skillSource.value))

const { query: agentQuery, setQuery: setAgentQuery, filteredItems: filteredAgents } =
  useSearch(agentItems, (a) => `${a.name} ${a.description} ${a.plugin} ${a.source}`)

const { query: skillQuery, setQuery: setSkillQuery, filteredItems: filteredSkills } =
  useSearch(skillItems, (s) => `${s.name} ${s.description} ${s.plugin} ${s.source}`)

// Đổi project -> catalog đổi -> nguồn đang chọn có thể không còn trong option.
// Rơi về 'all' thay vì để select trắng và danh sách rỗng không lý do.
function resetIfGone(options: { value: string }[], selected: { value: string }) {
  if (!options.some((o) => o.value === selected.value)) selected.value = 'all'
}
watch(agentSourceOptions, (opts) => resetIfGone(opts, agentSource))
watch(skillSourceOptions, (opts) => resetIfGone(opts, skillSource))

// Panel này gói 2 mục còn `RulesPanel` chỉ có 1; chia cột theo số panel thì mỗi
// mục của catalog chỉ được nửa phần của Rules. Chia theo SỐ MỤC ĐANG MỞ để mọi
// mục mở được phần bằng nhau (grow đổi, basis vẫn 0 — không trộn basis giữa các
// anh em cùng cấp, docs/ui-overflow.md).
const openCatalogCount = computed(
  () => ['agents', 'skills'].filter((k) => props.openSections.has(k)).length,
)
/** Chỉ khai `flex-grow` khi có >1 mục mở — 1 mục thì để class `--open` lo. */
const panelStyle = computed(() =>
  openCatalogCount.value > 1 ? { flexGrow: openCatalogCount.value } : undefined,
)

function sourceBadge(source) {
  if (!source) return ''
  if (source.startsWith('repo:')) return source.replace('repo:', 'repo ')
  if (source.startsWith('plugin:')) return source.replace('plugin:', 'plugin ')
  return source
}

/** Nhãn nguồn của một item; item không có `source` thì rơi về tên plugin. */
function badgeText(item: any): string {
  return sourceBadge(item.source) || item.plugin || ''
}

function onDragStart(event, item, type) {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/json', JSON.stringify({ ...item, _type: type }))
}
</script>

<template>
  <aside
    class="catalog-panel"
    :class="{ 'catalog-panel--open': openCatalogCount > 0 }"
    :style="panelStyle"
  >
    <CollapsibleSection
      :title="t('pipelineEditor.sections.agents')"
      :count="agentItems.length"
      :open="openSections.has('agents')"
      @toggle="emit('toggle-section', 'agents')"
    >
      <!-- `<select>` native vì popup của nó vẽ ở tầng OS nên không bị các ancestor
           `overflow: hidden` của mục/cột cắt (coding-guideline §5). -->
      <div class="catalog-toolbar">
        <select
          v-model="agentSource"
          class="catalog-source-filter"
          :aria-label="t('pipelineEditor.catalog.filterAgentSource')"
          :title="t('pipelineEditor.catalog.filterAgentSource')"
        >
          <option v-for="opt in agentSourceOptions" :key="opt.value" :value="opt.value">
            {{ t(opt.labelKey) }}
          </option>
        </select>
        <input
          class="catalog-search"
          :value="agentQuery"
          :placeholder="t('pipelineEditor.catalog.searchAgents')"
          :aria-label="t('pipelineEditor.catalog.searchAgents')"
          @input="setAgentQuery(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="catalog-list">
        <div
          v-for="agent in filteredAgents"
          :key="agent.id"
          class="catalog-item"
          draggable="true"
          @dragstart="onDragStart($event, agent, 'agent')"
          :title="agent.description"
        >
          <div class="catalog-item-name">{{ agent.name }}</div>
          <div class="catalog-item-meta">
            <span class="source-badge">{{ badgeText(agent) }}</span>
          </div>
          <div v-if="agent.skills?.length" class="catalog-item-skills">
            <span v-for="sk in agent.skills" :key="sk" class="chip chip-xs">{{ sk }}</span>
          </div>
        </div>
        <div v-if="!filteredAgents.length" class="catalog-empty">
          {{ t('pipelineEditor.catalog.noAgents') }}
        </div>
      </div>
    </CollapsibleSection>

    <CollapsibleSection
      :title="t('pipelineEditor.sections.skills')"
      :count="skillItems.length"
      :open="openSections.has('skills')"
      @toggle="emit('toggle-section', 'skills')"
    >
      <div class="catalog-toolbar">
        <select
          v-model="skillSource"
          class="catalog-source-filter"
          :aria-label="t('pipelineEditor.catalog.filterSkillSource')"
          :title="t('pipelineEditor.catalog.filterSkillSource')"
        >
          <option v-for="opt in skillSourceOptions" :key="opt.value" :value="opt.value">
            {{ t(opt.labelKey) }}
          </option>
        </select>
        <input
          class="catalog-search"
          :value="skillQuery"
          :placeholder="t('pipelineEditor.catalog.searchSkills')"
          :aria-label="t('pipelineEditor.catalog.searchSkills')"
          @input="setSkillQuery(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="catalog-list">
        <!-- Danh sách tra cứu: skill không kéo được vào canvas (thả skill chỉ
             sinh step rác mang tên skill) nên không đặt `draggable`. -->
        <div
          v-for="skill in filteredSkills"
          :key="skill.id"
          class="catalog-item catalog-item--static"
          :title="skill.description"
        >
          <div class="catalog-item-name">{{ skill.name }}</div>
          <div class="catalog-item-meta">
            <span class="source-badge">{{ badgeText(skill) }}</span>
          </div>
          <div v-if="skill.description" class="catalog-item-desc">{{ skill.description }}</div>
        </div>
        <div v-if="!filteredSkills.length" class="catalog-empty">
          {{ t('pipelineEditor.catalog.noSkills') }}
        </div>
      </div>
    </CollapsibleSection>
  </aside>
</template>

<style scoped lang="scss">
/* Hợp đồng cuộn (docs/ui-overflow.md): panel chỉ giành chiều cao khi một trong
   các section của nó đang mở — để basis 0 cố định thì panel đóng vẫn ăn nửa
   cột. Vùng cuộn duy nhất là `.catalog-list`. */
.catalog-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  flex: 0 0 auto;
}
.catalog-panel--open { flex: 1 1 0; }

/* Hàng công cụ của một mục: xếp NGANG, một hàng duy nhất. Cột trái chia chiều
   cao cho 3 mục nên ngân sách cố định của mỗi mục trực tiếp trừ vào vùng cuộn:
   xếp dọc tốn ~70px/mục, đủ để `.catalog-list` sụp còn vài px ở viewport thấp
   (docs/ui-overflow.md — cắt cụt tệ hơn cuộn). Đổi lại nhãn nguồn đang chọn có
   thể bị ellipsis; `:title` trên select bù phần đọc đầy đủ. */
.catalog-toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  flex-shrink: 0;
}

/* Margin do `.catalog-toolbar` lo — control bên trong không tự đặt margin.
   `min-width: 0` là bắt buộc: `min-width: auto` mặc định của flex item giữ ô tìm
   ở bề rộng nội dung, đẩy select tràn khỏi hàng. */
.catalog-search {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 5px;
  padding: 5px 8px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
  flex-shrink: 0;
}
.catalog-search:focus { border-color: var(--accent); }

.catalog-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
  min-height: 0;
}

.catalog-item {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 9px;
  margin-bottom: 5px;
  cursor: grab;
  transition: border-color 0.15s;
}
.catalog-item:hover { border-color: var(--accent); }
.catalog-item:active { cursor: grabbing; }

/* Item chỉ để tra cứu — không kéo được thì không dùng con trỏ grab, và cũng
   không sáng viền accent như item tương tác được. */
.catalog-item--static { cursor: default; }
.catalog-item--static:active { cursor: default; }
.catalog-item--static:hover { border-color: var(--border); }

.catalog-item-name { font-size: 13px; font-weight: 600; color: var(--text); }
.catalog-item-meta { font-size: 10px; color: var(--muted); margin-top: 1px; }
.catalog-item-desc {
  font-size: 11px;
  color: var(--muted);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.catalog-item-skills { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 3px; }
.catalog-empty { color: var(--muted); font-size: 12px; padding: 12px 0; text-align: center; }

.catalog-source-filter {
  margin: 0;
  flex: 0 1 40%;
  min-width: 0;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 5px;
  padding: 4px 7px;
  font-size: 11px;
  font-family: inherit;
  flex-shrink: 0;
}

.source-badge {
  display: inline-block;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(139, 151, 163, 0.15);
  color: var(--muted);
}
</style>
