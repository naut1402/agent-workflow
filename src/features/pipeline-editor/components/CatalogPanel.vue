<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref, computed } from 'vue'
import { useSearch } from '../../../core/composables/useSearch'
import CollapsibleSection from './CollapsibleSection.vue'

const { t } = useI18nHelpers()

const props = defineProps({
  catalog: { type: Object as () => any, required: true }, // { skills: [], agents: [] }
  /** Khoá section đang mở, do PipelineEditor giữ (dùng chung với RulesPanel). */
  openSections: { type: Object as () => Set<string>, default: () => new Set(['agents']) },
})

const emit = defineEmits(['toggle-section'])

const sourceFilter = ref('all')

const SOURCE_OPTIONS = [
  { value: 'all', labelKey: 'pipelineEditor.catalog.sourceAll' },
  { value: 'project', labelKey: 'pipelineEditor.catalog.sourceProject' },
  { value: 'repo', labelKey: 'pipelineEditor.catalog.sourceRepo' },
  { value: 'plugin', labelKey: 'pipelineEditor.catalog.sourcePlugin' },
  { value: 'user', labelKey: 'pipelineEditor.catalog.sourceUser' },
  { value: 'cursor', labelKey: 'pipelineEditor.catalog.sourceCursor' },
]

function matchesSource(item) {
  if (sourceFilter.value === 'all') return true
  const src = item.source || ''
  if (sourceFilter.value === 'repo') return src.startsWith('repo:')
  if (sourceFilter.value === 'plugin') return src.startsWith('plugin:')
  return src === sourceFilter.value
}

const agentItems = computed<any[]>(() =>
  (props.catalog.agents || []).filter(matchesSource),
)
const skillItems = computed<any[]>(() =>
  (props.catalog.skills || []).filter(matchesSource),
)

const { query: agentQuery, setQuery: setAgentQuery, filteredItems: filteredAgents } =
  useSearch(agentItems, (a) => `${a.name} ${a.description} ${a.plugin} ${a.source}`)

const { query: skillQuery, setQuery: setSkillQuery, filteredItems: filteredSkills } =
  useSearch(skillItems, (s) => `${s.name} ${s.description} ${s.plugin} ${s.source}`)

function sourceBadge(source) {
  if (!source) return ''
  if (source.startsWith('repo:')) return source.replace('repo:', 'repo ')
  if (source.startsWith('plugin:')) return source.replace('plugin:', 'plugin ')
  return source
}

function onDragStart(event, item, type) {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/json', JSON.stringify({ ...item, _type: type }))
}
</script>

<template>
  <aside class="catalog-panel">
    <select v-model="sourceFilter" class="catalog-source-filter">
      <option v-for="opt in SOURCE_OPTIONS" :key="opt.value" :value="opt.value">
        {{ t(opt.labelKey) }}
      </option>
    </select>

    <CollapsibleSection
      :title="t('pipelineEditor.sections.agents')"
      :count="agentItems.length"
      :open="openSections.has('agents')"
      @toggle="emit('toggle-section', 'agents')"
    >
      <input
        class="catalog-search"
        :value="agentQuery"
        :placeholder="t('pipelineEditor.catalog.searchAgents')"
        :aria-label="t('pipelineEditor.catalog.searchAgents')"
        @input="setAgentQuery(($event.target as HTMLInputElement).value)"
      />
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
            <span class="source-badge">{{ sourceBadge(agent.source) || agent.plugin }}</span>
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
      <input
        class="catalog-search"
        :value="skillQuery"
        :placeholder="t('pipelineEditor.catalog.searchSkills')"
        :aria-label="t('pipelineEditor.catalog.searchSkills')"
        @input="setSkillQuery(($event.target as HTMLInputElement).value)"
      />
      <div class="catalog-list">
        <div
          v-for="skill in filteredSkills"
          :key="skill.id"
          class="catalog-item"
          draggable="true"
          @dragstart="onDragStart($event, skill, 'skill')"
          :title="skill.description"
        >
          <div class="catalog-item-name">{{ skill.name }}</div>
          <div class="catalog-item-meta">
            <span class="source-badge">{{ sourceBadge(skill.source) || skill.plugin }}</span>
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
.catalog-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.catalog-search {
  margin: 8px;
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

.catalog-item-name { font-size: 13px; font-weight: 600; color: var(--text); }
.catalog-item-meta { font-size: 10px; color: var(--muted); margin-top: 1px; }
.catalog-item-desc { font-size: 11px; color: var(--muted); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.catalog-item-skills { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 3px; }
.catalog-empty { color: var(--muted); font-size: 12px; padding: 12px 0; text-align: center; }

.catalog-source-filter {
  margin: 6px 8px;
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
