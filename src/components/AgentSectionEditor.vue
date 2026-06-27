<script setup>
import { ref, computed } from 'vue'
import {
  FIXED_SECTION_KEYS,
  getSectionTitle,
  slugifySectionKey,
  emptyDraft,
} from '../lib/agentMarkdown.js'
import { useSortable } from '../lib/useSortable.js'
import { saveAgentTemplate } from '../api.js'
import WorkflowSectionEditor from './WorkflowSectionEditor.vue'

const props = defineProps({
  draft: { type: Object, required: true },
  catalog: { type: Object, default: () => ({ skills: [] }) },
})

const emit = defineEmits(['update:draft', 'message', 'error'])

const collapsed = ref(new Set())
const savingTemplate = ref('')

const order = computed({
  get: () => props.draft.section_order || [],
  set: (v) => emit('update:draft', { ...props.draft, section_order: v }),
})

const { onDragStart, onDragOver, onDragEnd } = useSortable(order, (items) => {
  emit('update:draft', { ...props.draft, section_order: items })
})

function sectionLabel(key) {
  return getSectionTitle(key, props.draft)
}

function isFixedSection(key) {
  return FIXED_SECTION_KEYS.includes(key)
}

function canRemoveSection(key) {
  return !isFixedSection(key)
}

function isCollapsed(key) {
  return collapsed.value.has(key)
}

function toggleCollapse(key) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

function updateSection(key, value) {
  emit('update:draft', {
    ...props.draft,
    sections: { ...props.draft.sections, [key]: value },
  })
}

function updateField(field, value) {
  emit('update:draft', { ...props.draft, [field]: value })
}

function addParameter() {
  const parameters = [...(props.draft.parameters || []), { name: '', description: '' }]
  updateField('parameters', parameters)
}

function removeParameter(i) {
  const parameters = [...(props.draft.parameters || [])]
  parameters.splice(i, 1)
  updateField('parameters', parameters)
}

function updateParameter(i, field, value) {
  const parameters = [...(props.draft.parameters || [])]
  parameters[i] = { ...parameters[i], [field]: value }
  updateField('parameters', parameters)
}

function toggleSkill(skillName) {
  const skills = new Set(props.draft.skills || [])
  if (skills.has(skillName)) skills.delete(skillName)
  else skills.add(skillName)
  updateField('skills', [...skills])
}

function removeSection(key) {
  if (!canRemoveSection(key)) return
  const title = sectionLabel(key)
  if (!confirm(`Xóa section "${title}"?`)) return
  const section_order = props.draft.section_order.filter((k) => k !== key)
  const sections = { ...props.draft.sections }
  delete sections[key]
  const section_labels = { ...(props.draft.section_labels || {}) }
  delete section_labels[key]
  emit('update:draft', { ...props.draft, section_order, sections, section_labels })
  collapsed.value.delete(key)
}

function addSection() {
  const title = prompt('Tên section mới:')
  if (!title?.trim()) return
  const slug = slugifySectionKey(title)
  let key = `custom_${slug}`
  let n = 1
  while (props.draft.sections?.[key] !== undefined || props.draft.section_order?.includes(key)) {
    key = `custom_${slug}-${n++}`
  }
  const section_labels = { ...(props.draft.section_labels || {}), [key]: title.trim() }
  const sections = { ...props.draft.sections, [key]: '' }
  const section_order = [...(props.draft.section_order || []), key]
  emit('update:draft', { ...props.draft, sections, section_order, section_labels })
}

async function saveSectionTemplate(key) {
  const title = sectionLabel(key)
  const content = (props.draft.sections?.[key] || '').trim()
  if (!content) {
    emit('error', `Section "${title}" trống — không lưu được template`)
    return
  }
  const defaultName = `section-${slugifySectionKey(title)}`
  const name = prompt('Tên template section:', defaultName)
  if (!name?.trim()) return

  savingTemplate.value = key
  try {
    const tplDraft = emptyDraft({
      name: name.trim(),
      description: `Template section: ${title}`,
      sections: { [key]: content },
      section_order: [key],
      section_labels: key.startsWith('custom_') ? { [key]: title } : {},
    })
    const result = await saveAgentTemplate(tplDraft)
    emit('message', `Đã lưu template section → ${result.name}`)
  } catch (e) {
    emit('error', String(e.message || e))
  } finally {
    savingTemplate.value = ''
  }
}
</script>

<template>
  <div class="agent-section-editor">
    <label class="cfg-label">
      Skills (frontmatter)
      <div class="skill-chips">
        <button
          v-for="sk in (catalog.skills || []).slice(0, 40)"
          :key="sk.id"
          type="button"
          class="chip chip-skill"
          :class="{ active: (draft.skills || []).includes(sk.name) }"
          @click="toggleSkill(sk.name)"
        >
          {{ sk.name }}
        </button>
      </div>
    </label>

    <div class="parameters-block">
      <div class="parameters-head">
        <span class="cfg-label">Parameters</span>
        <button type="button" class="btn-ghost btn-sm" @click="addParameter">+ param</button>
      </div>
      <div v-for="(p, i) in draft.parameters || []" :key="i" class="param-row">
        <input v-model="p.name" class="cfg-input cfg-input-sm" placeholder="name" @input="updateParameter(i, 'name', p.name)" />
        <input v-model="p.description" class="cfg-input" placeholder="description" @input="updateParameter(i, 'description', p.description)" />
        <button type="button" class="btn-ghost btn-sm" @click="removeParameter(i)">✕</button>
      </div>
    </div>

    <div class="section-list-head">
      <span class="cfg-label">Sections</span>
      <button type="button" class="btn-ghost btn-sm" @click="addSection">+ Section</button>
    </div>

    <div class="section-list">
      <div
        v-for="(key, index) in draft.section_order"
        :key="key"
        class="section-block"
        :class="{ collapsed: isCollapsed(key) }"
        draggable="true"
        @dragstart="onDragStart(index)"
        @dragover="onDragOver($event, index)"
        @dragend="onDragEnd"
      >
        <div class="section-head">
          <span class="drag-handle" title="Kéo để sắp xếp">⋮⋮</span>
          <button
            type="button"
            class="section-collapse-btn"
            :aria-expanded="!isCollapsed(key)"
            @click="toggleCollapse(key)"
          >
            {{ isCollapsed(key) ? '▶' : '▼' }}
          </button>
          <span class="section-title">{{ sectionLabel(key) }}</span>
          <span v-if="isFixedSection(key)" class="chip chip-xs">cố định</span>
          <div class="section-head-actions">
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="savingTemplate === key"
              title="Lưu section làm template"
              @click="saveSectionTemplate(key)"
            >
              {{ savingTemplate === key ? '…' : 'Lưu template' }}
            </button>
            <button
              v-if="canRemoveSection(key)"
              type="button"
              class="btn-ghost btn-sm btn-danger"
              title="Xóa section"
              @click="removeSection(key)"
            >
              ✕
            </button>
          </div>
        </div>
        <div v-show="!isCollapsed(key)" class="section-body">
          <WorkflowSectionEditor
            v-if="key === 'workflow'"
            :model-value="draft.sections?.[key] || ''"
            @update:model-value="updateSection(key, $event)"
            @message="emit('message', $event)"
            @error="emit('error', $event)"
          />
          <textarea
            v-else
            class="cfg-textarea"
            :value="draft.sections?.[key] || ''"
            rows="4"
            @input="updateSection(key, $event.target.value)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
