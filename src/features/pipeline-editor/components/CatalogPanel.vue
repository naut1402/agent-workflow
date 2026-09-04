<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSearch } from '../../../core/composables/useSearch'

const props = defineProps({
  catalog: { type: Object as () => any, required: true }, // { skills: [], agents: [] }
})

const activeTab = ref('agents') // 'agents' | 'skills' | 'rules'
const sourceFilter = ref('all')

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All sources' },
  { value: 'project', label: 'Project' },
  { value: 'repo', label: 'Repo' },
  { value: 'plugin', label: 'Plugin' },
  { value: 'user', label: 'User' },
  { value: 'cursor', label: 'Cursor' },
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
    <div class="catalog-tabs">
      <button
        class="catalog-tab"
        :class="{ active: activeTab === 'agents' }"
        @click="activeTab = 'agents'"
      >
        Agents ({{ agentItems.length }})
      </button>
      <button
        class="catalog-tab"
        :class="{ active: activeTab === 'skills' }"
        @click="activeTab = 'skills'"
      >
        Skills ({{ skillItems.length }})
      </button>
    </div>

    <select v-model="sourceFilter" class="catalog-source-filter">
      <option v-for="opt in SOURCE_OPTIONS" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>

    <!-- Agents tab -->
    <template v-if="activeTab === 'agents'">
      <input
        class="catalog-search"
        :value="agentQuery"
        placeholder="Search agents…"
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
        <div v-if="!filteredAgents.length" class="catalog-empty">No agents found</div>
      </div>
    </template>

    <!-- Skills tab -->
    <template v-else>
      <input
        class="catalog-search"
        :value="skillQuery"
        placeholder="Search skills…"
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
        <div v-if="!filteredSkills.length" class="catalog-empty">No skills found</div>
      </div>
    </template>
  </aside>
</template>

<style scoped lang="scss">
.catalog-panel {
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.catalog-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
}

.catalog-tab {
  flex: 1;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  padding: 8px 6px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.catalog-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.catalog-tab:hover:not(.active) { color: var(--text); }

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
}
.catalog-search:focus { border-color: var(--accent); }

.catalog-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
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
  margin: 6px 8px 0;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 5px;
  padding: 4px 7px;
  font-size: 11px;
  font-family: inherit;
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
