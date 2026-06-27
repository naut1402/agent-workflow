<script setup>
import { ref, computed } from 'vue'
import { useSearch } from '../lib/useSearch.js'

const props = defineProps({
  catalog: { type: Object, required: true }, // { skills: [], agents: [] }
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

const agentItems = computed(() =>
  (props.catalog.agents || []).filter(matchesSource),
)
const skillItems = computed(() =>
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
        @input="setAgentQuery($event.target.value)"
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
        @input="setSkillQuery($event.target.value)"
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
